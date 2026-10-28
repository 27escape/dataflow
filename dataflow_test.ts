// Run with: deno test dataflow_test.ts
import {
  generateReport,
  lex,
  Parser,
  parseThreat,
  render,
  shouldSkipOutput,
  validateThreats,
} from "./dataflow.ts";

function eq<T>(actual: T, expected: T, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw Error(`${msg}\n  expected: ${e}\n  actual:   ${a}`);
}
function ok(cond: unknown, msg: string) {
  if (!cond) throw Error(msg);
}
const parse = (src: string) => new Parser(lex(src)).parse();

const BASIC = `diagram {
  title = "T"
  io a { title = "A" }
  function b { title = "B" }
  a -> b { operation = "op" data = ["d"] }
}`;

Deno.test("lexer: // line comments are skipped and lines still counted", () => {
  const toks = lex('diagram {\n // note\n bogus\n}');
  eq(toks.find((t) => t.value === "bogus")!.line, 3);
});

Deno.test("lexer: multi-line string reports its starting line", () => {
  const toks = lex('a = `x\ny\nz`');
  eq(toks.find((t) => t.kind === "string")!.line, 1);
});

Deno.test("lexer: backtick strings are trimmed on both ends of each line", () => {
  const toks = lex("a = `one  \n   two  `");
  eq(toks.find((t) => t.kind === "string")!.value, "one\ntwo");
});

Deno.test("parser: unknown flow endpoint error carries a line number", () => {
  let msg = "";
  try {
    parse('diagram {\n io a { }\n a -> ghost { }\n}');
  } catch (e) {
    msg = (e as Error).message;
  }
  ok(msg.startsWith("Line 3:"), msg);
});

Deno.test("parseThreat: scored, unscored, plain, and non-numeric bracket", () => {
  const a = parseThreat("[s, t] [High] [8.5] Desc");
  eq([a.cats, a.risk, a.score, a.desc], ["S, T", "High", "8.5", "Desc"]);
  const b = parseThreat("[I] [Low] Minor");
  eq([b.score, b.desc], ["N/A", "Minor"]);
  eq(parseThreat("Plain").isStride, false);
  const c = parseThreat("[T] [High] [Fix] the thing");
  eq([c.score, c.desc], ["N/A", "[Fix] the thing"]);
});

Deno.test("parseThreat: multi-line description is matched and flattened", () => {
  const t = parseThreat("[S] [High] [8] Spoofing that is\n   described twice");
  ok(t.isStride, "should be STRIDE");
  eq(t.desc, "Spoofing that is described twice");
});

Deno.test("validateThreats: flags bad letter, bad risk, malformed bracket", () => {
  const d = parse(`diagram {
    threats = ["[X] [Severe] Nope", "[WIP] later"]
    io a { }
  }`);
  const w = validateThreats(d).join("\n");
  ok(w.includes('unknown STRIDE category "X"'), w);
  ok(w.includes('unknown risk "Severe"'), w);
  ok(w.includes('treated as plain text'), w);
});

Deno.test("report: escapes pipes and angle brackets", () => {
  const d = parse(`diagram {
    io a { title = "A" }
    function b { title = "B" }
    a -> b { operation = "Save <b>x</b>" threats = ["[T] [High] [5] a | b"] }
  }`);
  const md = generateReport(d);
  ok(md.includes("a \\| b"), "pipe not escaped");
  ok(md.includes("Save &lt;b&gt;x&lt;/b&gt;"), "html not escaped");
});

Deno.test("dfd: keyword IDs are quoted and data-only flows keep their prefix", () => {
  const d = parse(`diagram {
    io node { title = "N" }
    function b { title = "B" }
    node -> b { data = ["only data"] }
  }`);
  const dot = render(d, true);
  ok(dot.includes('"node" -> "b"'), "ids not quoted");
  ok(!dot.includes("&lt;font"), "prefix markup was escaped");
  ok(dot.includes("(1)"), "flow number missing");
});

Deno.test("sequence: aliases are prefixed and note uses the worst risk colour", () => {
  const d = parse(`diagram {
    io end { title = "E" }
    function b { title = "B" }
    end -> b { threats = ["[I] [Low] a", "[S] [Critical] b"] }
  }`);
  const puml = render(d, false);
  ok(puml.includes("as n_end"), "alias not prefixed");
  ok(puml.includes("#FFB3B3"), "expected the Critical colour");
});

Deno.test("sequence: diagram attribute comment shows key and value", () => {
  const puml = render(parse(BASIC.replace('title = "T"', 'title = "T" owner = "me"')), false);
  ok(puml.includes("' Diagram attributes: owner: me"), puml);
});

Deno.test("output freshness: skip generation if output is newer than source unless forced", async () => {
  const dir = await Deno.makeTempDir();
  const source = `${dir}/source.flow`;
  const output = `${dir}/diagram.svg`;

  await Deno.writeTextFile(source, "diagram { io a { } function b { } a -> b { } }");
  await Deno.writeTextFile(output, "<svg />");

  const srcTime = new Date("2020-01-01T00:00:00Z");
  const outTime = new Date("2030-01-01T00:00:00Z");
  Deno.utimeSync(source, srcTime, srcTime);
  Deno.utimeSync(output, outTime, outTime);

  eq(shouldSkipOutput(source, output, false), true, "older source should be skipped");
  eq(shouldSkipOutput(source, output, true), false, "force should bypass skip");
});

Deno.test("explain: report and diagrams include a STRIDE legend when enabled", () => {
  const d = parse(`diagram {
    io user { title = "User" }
    function api { title = "API" }
    user -> api { operation = "Login" threats = ["[S, T] [High] [8] Cross-check"] }
  }`);

  const md = generateReport(d, true);
  ok(md.includes("## STRIDE Overview"), "report is missing the STRIDE overview");
  ok(md.includes("Spoofing"), "report overview does not explain spoofing");

  const seq = render(d, false, true);
  ok(seq.includes("legend right"), "sequence diagram is missing the legend");
  ok(seq.includes("S = Spoofing"), "sequence legend misses the spoofing entry");

  const dot = render(d, true, true);
  ok(dot.includes("STRIDE"), "graphviz legend title missing");
  ok(dot.includes("Spoofing"), "graphviz legend missing STRIDE meaning");
  ok(dot.includes("labeljust=\"r\""), "graphviz legend is not aligned to the right of the graph");
  ok(dot.includes("fontsize=9"), "graphviz legend font is not smaller");
});
