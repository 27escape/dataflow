#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/** Convert Sony Xperia DataFlow syntax to PlantUML, Graphviz, or a Markdown Report. */

type Value = string | Value[];
type Attrs = Record<string, Value>;

type Node = {
  kind: "io" | "function" | "database";
  id: string;
  attrs: Attrs;
  boundary?: string;
};

type Boundary = { id: string; attrs: Attrs };
type Flow = { from: string; to: string; attrs: Attrs };

type Diagram = {
  attrs: Attrs;
  nodes: Node[];
  boundaries: Boundary[];
  flows: Flow[];
};

type Token = { kind: string; value: string; line: number };

function lex(source: string): Token[] {
  const out: Token[] = [];
  let i = 0, line = 1;
  const add = (kind: string, value: string, l = line) =>
    out.push({ kind, value, line });

  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) {
      if (c === "\n") line++;
      i++;
      continue;
    }
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) throw Error(`Unclosed comment at line ${line}`);
      const s = source.slice(i, end + 2);
      line += (s.match(/\n/g) || []).length;
      i = end + 2;
      continue;
    }
    if (source.startsWith("->", i) || source.startsWith("<-", i)) {
      add("arrow", source.slice(i, i + 2));
      i += 2;
      continue;
    }
    if (c === '"' || c === "`") {
      const start = line;
      const quote = c;
      let j = i + 1;
      while (j < source.length && source[j] !== quote) {
        if (source[j] === "\n") line++;
        j++;
      }
      if (j === source.length) throw Error(`Unclosed string at line ${start}`);
      let v = source.slice(i + 1, j);
      if (quote === "`") {
        v = v.split("\n").map((x) => x.trimStart()).join("\n").trim();
      }
      add("string", v, start);
      i = j + 1;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      const m = /^[A-Za-z][A-Za-z0-9_]*/.exec(source.slice(i))!;
      add("id", m[0]);
      i += m[0].length;
      continue;
    }
    if ("{}[]=,".includes(c)) {
      add(c, c);
      i++;
      continue;
    }
    throw Error(`Unexpected character ${JSON.stringify(c)} at line ${line}`);
  }
  out.push({ kind: "eof", value: "", line });
  return out;
}

class Parser {
  private i = 0;
  private ids = new Set<string>();
  private diagram: Diagram = {
    attrs: {},
    nodes: [],
    boundaries: [],
    flows: [],
  };

  constructor(private tokens: Token[]) {}

  private peek(n = 0) {
    return this.tokens[this.i + n];
  }

  private take(kind: string, value?: string) {
    const t = this.peek();
    if (t.kind !== kind || (value !== undefined && t.value !== value)) {
      throw Error(
        `Line ${t.line}: expected ${value ?? kind}, found ${t.value || t.kind}`,
      );
    }
    this.i++;
    return t.value;
  }

  private match(kind: string, value?: string) {
    if (
      this.peek().kind === kind &&
      (value === undefined || this.peek().value === value)
    ) {
      this.i++;
      return true;
    }
    return false;
  }

  private value(): Value {
    if (this.peek().kind === "string") return this.take("string");
    if (this.match("[")) {
      const a: Value[] = [];
      while (!this.match("]")) {
        a.push(this.value());
        if (this.match("]")) break;
        this.take(",");
      }
      return a;
    }
    throw Error(`Line ${this.peek().line}: expected string or array`);
  }

  private attrs(): Attrs {
    const a: Attrs = {};
    while (this.peek().kind === "id" && this.peek(1).kind === "=") {
      const k = this.take("id");
      this.take("=");
      if (Object.hasOwn(a, k)) throw Error(`Duplicate attribute ${k}`);
      a[k] = this.value();
    }
    return a;
  }

  private unique(id: string) {
    if (this.ids.has(id)) throw Error(`Duplicate node/boundary ID: ${id}`);
    this.ids.add(id);
  }

  private node(boundary?: string) {
    const kind = this.take("id") as Node["kind"];
    const id = this.take("id");
    this.unique(id);
    let attrs: Attrs = {};
    if (this.match("{")) {
      attrs = this.attrs();
      this.take("}");
    }
    this.diagram.nodes.push({ kind, id, attrs, boundary });
  }

  parse(): Diagram {
    this.take("id", "diagram");
    this.take("{");
    this.diagram.attrs = this.attrs();

    while (!this.match("}")) {
      const t = this.peek();
      if (t.kind !== "id") {
        throw Error(`Line ${t.line}: expected node, boundary or flow`);
      }

      if (t.value === "boundary") {
        this.take("id");
        const id = this.take("id");
        this.unique(id);
        this.take("{");
        const attrs = this.attrs();
        this.diagram.boundaries.push({ id, attrs });
        while (!this.match("}")) {
          const n = this.peek().value;
          if (!["io", "function", "database"].includes(n)) {
            throw Error(
              `Line ${this.peek().line}: only nodes are allowed inside boundaries`,
            );
          }
          this.node(id);
        }
        continue;
      }

      if (["io", "function", "database"].includes(t.value)) {
        this.node();
        continue;
      }

      const left = this.take("id");
      const arrow = this.take("arrow");
      const right = this.take("id");
      let attrs: Attrs = {};
      if (this.match("{")) {
        attrs = this.attrs();
        this.take("}");
      }
      this.diagram.flows.push({
        from: arrow === "->" ? left : right,
        to: arrow === "->" ? right : left,
        attrs,
      });
    }
    this.take("eof");

    for (const f of this.diagram.flows) {
      if (!this.diagram.nodes.some((n) => n.id === f.from)) {
        throw Error(`Unknown flow source: ${f.from}`);
      }
      if (!this.diagram.nodes.some((n) => n.id === f.to)) {
        throw Error(`Unknown flow target: ${f.to}`);
      }
    }

    return this.diagram;
  }
}

const str = (v: Value | undefined): string =>
  v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
const label = (a: Attrs, fallback: string) => str(a.title) || fallback;
const extras = (a: Attrs, used: string[]) =>
  Object.entries(a).filter(([k]) => !used.includes(k)).map(([k, v]) =>
    `${k}: ${str(v)}`
  );

const clean = (s: string) => s.replace(/\r/g, "").replace(/\n/g, " / ");
const pu = (s: string) =>
  clean(s).replace(/\\/g, "\\\\").replace(/"/g, "'").replace(/\[/g, "(")
    .replace(/\]/g, ")");

const gv = (s: string) => 
  clean(s).replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/&lt;(\/?(?:sub|sup|b|i))&gt;/gi, "<$1>");

function generateReport(d: Diagram): string {
  const lines: string[] = [];
  const title = str(d.attrs.title) || "System Threat Model";
  lines.push(`# ${title}\n`);

  const desc = str(d.attrs.description);
  if (desc) lines.push(`${desc}\n`);

  const getList = (v: Value | undefined) => v === undefined ? [] : Array.isArray(v) ? v : [v];
  
  const threats = getList(d.attrs.threats).map(String);
  if (threats.length > 0) {
    lines.push(`## Global Threats`);
    threats.forEach(t => lines.push(`- **${t}**`));
    lines.push("");
  }

  lines.push(`## Data Flows\n`);
  d.flows.forEach((f, index) => {
    const fromNode = d.nodes.find(n => n.id === f.from);
    const toNode = d.nodes.find(n => n.id === f.to);
    const fromName = label(fromNode?.attrs || {}, f.from);
    const toName = label(toNode?.attrs || {}, f.to);
    const op = str(f.attrs.operation) || "Flow";
    
    lines.push(`### ${index + 1}. ${fromName} -> ${toName}: ${op}`);
    
    const data = getList(f.attrs.data).map(String);
    if (data.length > 0) {
      lines.push(`- **Data Exchanged:** ${data.join(", ")}`);
    }
    
    const fThreats = getList(f.attrs.threats).map(String);
    if (fThreats.length > 0) {
      lines.push(`- **Identified Threats:** ${fThreats.join(", ")}`);
    }
    
    const fDesc = str(f.attrs.description);
    if (fDesc) {
      lines.push(`\n**Description:**\n${fDesc}\n`);
    } else {
      lines.push("");
    }
  });

  return lines.join("\n");
}

function render(d: Diagram, dataflow: boolean): string {
  const lines: string[] = [];
  const title = str(d.attrs.title);
  const diagramExtra = extras(d.attrs, ["title"]);
  
  if (dataflow) {
    // Graphviz DFD Rendering
    let dfdFlowIndex = 1;
    lines.push('digraph G {');
    lines.push('  rankdir=TB;');
    
    lines.push('  graph [fontname="Helvetica"];');
    lines.push('  node [fontname="Helvetica", shape="box", style="solid"];');
    lines.push('  edge [fontname="Helvetica", fontsize=11];');
    
    if (title) {
      lines.push(`  labelloc="t";`);
      lines.push(`  label="${gv(title)}";`);
      lines.push(`  fontsize=18;`);
    }

    const node = (n: Node) => {
      const name = label(n.attrs, n.id);
      if (n.kind === "database") {
        lines.push(`  ${n.id} [shape=none, margin=0, label=<<table border="0" cellborder="1" cellspacing="0" cellpadding="6"><tr><td sides="TB" bgcolor="#CD3B48" color="#982C35"><font face="Helvetica" color="white">${gv(name)}</font></td></tr></table>>];`);
      } else if (n.kind === "io") {
        lines.push(`  ${n.id} [label="${gv(name)}", shape="box", style="filled,solid", fillcolor="#989898", color="#CD3B48", fontcolor="white"];`);
      } else {
        lines.push(`  ${n.id} [label="${gv(name)}", shape="circle", style="filled,solid", fillcolor="#E2EAF9", color="#A9B8D6"];`);
      }
    };

    for (const b of d.boundaries) {
      lines.push(`  subgraph cluster_${b.id} {`);
      lines.push(`    label="${gv(label(b.attrs, b.id))}";`);
      lines.push(`    style="dashed,filled";`);
      lines.push(`    fillcolor="#F9F9F9";`);
      lines.push(`    color="#777777";`);
      lines.push(`    fontcolor="#777777";`);
      for (const n of d.nodes.filter((n) => n.boundary === b.id)) node(n);
      lines.push(`  }`);
    }
    
    for (const n of d.nodes.filter((n) => !n.boundary)) node(n);

    const getKind = (id: string) => d.nodes.find((n) => n.id === id)?.kind || "function";
    const getRank = (kind: string) => kind === "io" ? 1 : kind === "function" ? 2 : 3;
    const seenAsSource = new Set<string>();

    for (const f of d.flows) {
      const getList = (v: Value | undefined) => v === undefined ? [] : Array.isArray(v) ? v : [v];
      const opList = getList(f.attrs.operation).map(String);
      const dataList = getList(f.attrs.data).map(String);

      let htmlLabel = "";
      if (opList.length > 0 || dataList.length > 0) {
        const prefix = `<font color="#3182ce">(${dfdFlowIndex})</font> `;
        if (opList.length > 0) {
          opList[0] = prefix + gv(opList[0]);
        } else {
          dataList[0] = prefix + gv(dataList[0]);
        }
        dfdFlowIndex++;
        
        const combined = [...opList.map(o => o.includes("<font") ? o : gv(o)), ...dataList.map(gv)];
        htmlLabel = `<<table border="0" cellborder="0" cellpadding="2"><tr><td><font face="Helvetica">${combined.join('</font></td></tr><tr><td><font face="Helvetica">')}</font></td></tr></table>>`;
      }
      
      const fromRank = getRank(getKind(f.from));
      const toRank = getRank(getKind(f.to));
      
      const constraint = (fromRank > toRank || seenAsSource.has(f.to)) ? ", constraint=false" : "";
      seenAsSource.add(f.from);
      
      lines.push(`  ${f.from} -> ${f.to} [label=${htmlLabel || '""'}${constraint}];`);
    }

    lines.push('}');
    return lines.join('\n') + '\n';
  } else {
    // PlantUML Sequence Rendering
    lines.push("@startuml");
    lines.push("skinparam shadowing false");
    lines.push("skinparam defaultFontName sans-serif");
    lines.push("skinparam participantBackgroundColor #E2EAF9");
    lines.push("skinparam participantBorderColor #A9B8D6");
    lines.push("skinparam databaseBackgroundColor #CD3B48");
    lines.push("skinparam databaseBorderColor #982C35");
    lines.push("skinparam entityBackgroundColor #989898");
    lines.push("skinparam entityBorderColor #CD3B48");
    lines.push("skinparam SequenceEntityBorderColor #CD3B48");
    lines.push("skinparam entityBorderThickness 2");
    lines.push("skinparam sequenceLifeLineBorderColor #AAAAAA");
    lines.push("skinparam sequenceArrowColor #444444");

    if (title) {
      lines.push(`title ${pu(title)}`);
    }

    const formatFlowText = (opV: Value | undefined, dataV: Value | undefined): string => {
      const getList = (v: Value | undefined) => v === undefined ? [] : Array.isArray(v) ? v : [v];
      let opList = getList(opV).map(String);
      let dataList = getList(dataV).map(String);

      opList = opList.map(o => `**<color:#444444>${pu(o)}</color>**`);
      dataList = dataList.map(d => `//<color:#666666>${pu(d)}</color>//`);
      return [...opList, ...dataList].filter(Boolean).join("\\n");
    };

    const defineSeqNode = (n: Node) => {
      const name = label(n.attrs, n.id);
      const kind = n.kind === "database" ? "database" : n.kind === "io" ? "entity" : "participant";
      lines.push(`  ${kind} "**${pu(name)}**" as ${n.id}`);
    };

    for (const b of d.boundaries) {
      lines.push(`  box "<color:#666666><i>${pu(label(b.attrs, b.id))}</i></color>" #F9F9F9`);
      for (const n of d.nodes.filter((n) => n.boundary === b.id)) defineSeqNode(n);
      lines.push(`  end box`);
    }
    
    for (const n of d.nodes.filter((n) => !n.boundary)) defineSeqNode(n);

    for (const n of d.nodes) {
      const x = extras(n.attrs, ["title"]);
      if (x.length) {
        lines.push(`  note over ${n.id}: ${pu(x.join(" | "))}`);
      }
    }

    for (const f of d.flows) {
      let text = formatFlowText(f.attrs.operation, f.attrs.data);
      if (!text) text = pu("Flow");
      
      const desc = str(f.attrs.description),
        x = extras(f.attrs, ["operation", "data", "description"]);
        
      lines.push(`  ${f.from} -> ${f.to}: ${text}`);
      
      if (desc || x.length) {
        lines.push(`note over ${f.from},${f.to}: ${pu([desc, ...x].filter(Boolean).join(" | "))}`);
      }
    }

    if (diagramExtra.length) {
      lines.push(`' Diagram attributes: ${diagramExtra.map(([k, v]) => `${k}: ${clean(str(v))}`).join(" | ")}`);
    }

    lines.push("@enduml");
    return lines.join("\n") + "\n";
  }
}

function usage() {
  return `Usage: dataflow.ts SOURCE.flow --output FILE [OPTIONS]\n\nOptions:\n  -o, --output FILE  Required output file (.png/.svg for images; .md for reports)\n  -d, --dataflow     Data-flow diagram (Graphviz) instead of default sequence diagram (PlantUML)\n  -r, --report       Generate a Markdown threat model report instead of an image\n  -h, --help         Show this help\n`;
}

async function main() {
  const args = Deno.args;
  let input = "", output = "", dataflow = false, report = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") {
      console.log(usage());
      return;
    }
    if (a === "-d" || a === "--dataflow") {
      dataflow = true;
      continue;
    }
    if (a === "-r" || a === "--report") {
      report = true;
      continue;
    }
    if (a === "-o" || a === "--output") {
      output = args[++i] ?? "";
      continue;
    }
    if (a.startsWith("-")) throw Error(`Unknown option: ${a}`);
    if (input) throw Error("Exactly one source file is required");
    input = a;
  }

  if (!input || !output) throw Error(usage());

  const source = await Deno.readTextFile(input);
  const d = new Parser(lex(source)).parse();
  
  if (report) {
    const mdText = generateReport(d);
    await Deno.writeTextFile(output, mdText);
    console.log(`Wrote ${output}`);
    return;
  }
  
  const text = render(d, dataflow);
  const ext = output.toLowerCase().match(/\.(png|svg)$/)?.[1];
  
  if (!ext) {
    await Deno.writeTextFile(output, text);
    console.log(`Wrote ${output}`);
    return;
  }

  const tmp = await Deno.makeTempDir({ dir: ".", prefix: ".dataflow-" });
  try {
    const path = `${tmp}/diagram.${dataflow ? "dot" : "puml"}`;
    await Deno.writeTextFile(path, text);
    
    const cmd = dataflow ? "dot" : "plantuml";
    const cmdArgs = dataflow ? [`-T${ext}`, path, "-o", output] : [`-t${ext}`, path];
    
    let result;
    try {
      result = await new Deno.Command(cmd, {
        args: cmdArgs,
        stdout: "piped",
        stderr: "piped",
      }).output();
    } catch (e) {
      throw Error(`Unable to run ${cmd}. Install it using Homebrew/Orbstack. ${e}`);
    }

    if (!result.success) {
      throw Error(`${cmd} failed: ${new TextDecoder().decode(result.stderr)}`);
    }

    if (!dataflow) {
      await Deno.copyFile(`${tmp}/diagram.${ext}`, output);
    }
    console.log(`Wrote ${output}`);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`dataflow: ${e instanceof Error ? e.message : String(e)}`);
    Deno.exit(1);
  });
}