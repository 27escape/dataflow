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
type Flow = { from: string; to: string; attrs: Attrs; line: number };

type Diagram = {
  attrs: Attrs;
  nodes: Node[];
  boundaries: Boundary[];
  flows: Flow[];
};

type Token = { kind: string; value: string; line: number };

export function lex(source: string): Token[] {
  const out: Token[] = [];
  let i = 0, line = 1;
  const add = (kind: string, value: string, l = line) =>
    out.push({ kind, value, line: l });

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
    // Line comment (extension to the upstream language); stops before the
    // newline so the whitespace branch above still counts the line.
    if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end;
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
        v = v.split("\n").map((x) => x.trim()).join("\n").trim();
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

export class Parser {
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

      const line = t.line;
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
        line,
      });
    }
    this.take("eof");

    const nodeIds = new Set(this.diagram.nodes.map((n) => n.id));
    for (const f of this.diagram.flows) {
      if (!nodeIds.has(f.from)) {
        throw Error(`Line ${f.line}: unknown flow source: ${f.from}`);
      }
      if (!nodeIds.has(f.to)) {
        throw Error(`Line ${f.line}: unknown flow target: ${f.to}`);
      }
    }

    return this.diagram;
  }
}

// ---------------------------------------------------------------------------
// STRIDE Threat Modeling Support
//
// Threat string format:  "[S, T] [High] [8.5] Description"
//                        "[S, T] [High] Description"        (score optional)
// Anything else is kept as a plain-text threat.
// ---------------------------------------------------------------------------
export type ParsedThreat = {
  isStride: boolean;
  cats?: string;
  invalid?: string[];
  risk?: string;
  score?: string;
  desc?: string;
  raw: string;
  from?: string;
  to?: string;
};

const STRIDE_LETTERS = new Set(["S", "T", "R", "I", "D", "E"]);
const KNOWN_RISKS = ["critical", "high", "medium", "low"];

// [\s\S] (not .) so descriptions written as multi-line backtick strings match.
// The score is only recognised when numeric, so "[Fix] ..." stays description.
const THREAT_RE =
  /^\[([^\]]*)\]\s*\[([^\]]*)\](?:\s*\[(\d+(?:\.\d+)?)\])?\s*([\s\S]+)$/;

export function parseThreat(t: string, from?: string, to?: string): ParsedThreat {
  const m = t.trim().match(THREAT_RE);
  if (m) {
    const letters = m[1].split(",").map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    return {
      isStride: true,
      cats: letters.join(", "),
      invalid: letters.filter((l) => !STRIDE_LETTERS.has(l)),
      risk: m[2].trim(),
      score: m[3] || "N/A",
      desc: m[4].replace(/\s*\n\s*/g, " ").trim(),
      raw: t,
      from,
      to,
    };
  }
  return { isStride: false, raw: t, from, to };
}

const riskRank = (risk: string) => {
  const i = KNOWN_RISKS.indexOf(risk.toLowerCase());
  return i < 0 ? 0 : KNOWN_RISKS.length - i; // critical=4 ... low=1, other=0
};

const riskEmoji = (risk: string) =>
  ["\u26AA", "\uD83D\uDFE2", "\uD83D\uDFE1", "\uD83D\uDFE0", "\uD83D\uDD34"][
    riskRank(risk)
  ]; // white, green, yellow, orange, red

const STRIDE_LEGEND: Array<[string, string]> = [
  ["S", "Spoofing: pretending to be another user, system, or service."],
  ["T", "Tampering: modifying data or code in transit or at rest."],
  ["R", "Repudiation: denying that an action occurred without proof."],
  ["I", "Information disclosure: exposing data to those without permission."],
  ["D", "Denial of service: disrupting or degrading service availability."],
  ["E", "Elevation of privilege: gaining access beyond what was intended."],
];

const strideLegendMarkdown = () =>
  [
    "## STRIDE Overview",
    "",
    "STRIDE is a threat-modeling mnemonic for common security risks. Each letter highlights a different category of attack or weakness.",
    "",
    "| Letter | Meaning | Description |",
    "|---|---|---|",
    ...STRIDE_LEGEND.map(([letter, desc]) =>
      `| ${letter} | ${desc.split(":")[0].trim()} | ${desc.replace(/^[^:]+:\s*/, "")} |`
    ),
    "",
  ].join("\n");

const strideLegendHtml = () =>
  [
    '<table border="1" cellborder="1" cellspacing="0" cellpadding="4">',
    '<tr><td><b>Letter</b></td><td><b>Meaning</b></td><td><b>Description</b></td></tr>',
    ...STRIDE_LEGEND.map(([letter, desc]) => {
      const idx = desc.indexOf(":");
      const meaning = idx >= 0 ? desc.slice(0, idx) : desc;
      const detail = idx >= 0 ? desc.slice(idx + 1).trim() : "";
      return `<tr><td>${letter}</td><td>${meaning}</td><td>${gv(detail)}</td></tr>`;
    }),
    "</table>",
  ].join("");

const getRiskColorGV = (risk: string) => {
  const r = risk.toLowerCase();
  if (r === "critical") return "#982C35";
  if (r === "high") return "#CD3B48";
  if (r === "medium") return "#D97706";
  if (r === "low") return "#059669";
  return "#444444";
};

const getRiskColorPUML = (risk: string) => {
  const r = risk.toLowerCase();
  if (r === "critical") return "#FFB3B3";
  if (r === "high") return "#FFCCCC";
  if (r === "medium") return "#FFE6CC";
  if (r === "low") return "#E6FFCC";
  return "#EEEEEE";
};

const getList = (v: Value | undefined): Value[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** Returns human-readable warnings about malformed or unrecognised threats. */
export function validateThreats(d: Diagram): string[] {
  const warnings: string[] = [];
  const check = (v: Value | undefined, where: string) => {
    for (const raw of getList(v).map(String)) {
      const t = parseThreat(raw);
      const snippet = raw.replace(/\s+/g, " ").slice(0, 60);
      if (t.isStride) {
        if (!t.cats) warnings.push(`${where}: no STRIDE category in "${snippet}"`);
        for (const l of t.invalid ?? []) {
          warnings.push(
            `${where}: unknown STRIDE category "${l}" (expected S, T, R, I, D or E) in "${snippet}"`,
          );
        }
        if (!KNOWN_RISKS.includes(t.risk!.toLowerCase())) {
          warnings.push(
            `${where}: unknown risk "${t.risk}" (expected Critical, High, Medium or Low) in "${snippet}"`,
          );
        }
      } else if (raw.trimStart().startsWith("[")) {
        warnings.push(
          `${where}: threat starts with "[" but is not in "[CATS] [Risk] [Score] description" format; treated as plain text: "${snippet}"`,
        );
      }
    }
  };
  check(d.attrs.threats, "diagram");
  for (const f of d.flows) check(f.attrs.threats, `flow ${f.from} -> ${f.to}`);
  return warnings;
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

// Markdown report helpers: escape angle brackets so stray HTML in titles,
// operations or threat text can't inject markup; escape pipes inside table cells.
const mdText = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
const mdCell = (s: string) => mdText(clean(s)).replace(/\|/g, "\\|");

export function generateReport(d: Diagram, explain = false): string {
  const lines: string[] = [];
  const title = str(d.attrs.title) || "System Threat Model";
  lines.push(`# ${mdText(title)}\n`);

  const desc = str(d.attrs.description);
  if (desc) lines.push(`${desc}\n`);

  const nameOf = (id: string) =>
    label(d.nodes.find((n) => n.id === id)?.attrs || {}, id);

  const allThreats: ParsedThreat[] = [];
  getList(d.attrs.threats).map(String).forEach((t) =>
    allThreats.push(parseThreat(t, "Global", "Architecture"))
  );
  d.flows.forEach((f) => {
    const fromName = nameOf(f.from), toName = nameOf(f.to);
    getList(f.attrs.threats).map(String).forEach((t) =>
      allThreats.push(parseThreat(t, fromName, toName))
    );
  });

  const strideThreats = allThreats.filter((t) => t.isStride);
  if (strideThreats.length > 0) {
    strideThreats.sort((a, b) =>
      (parseFloat(b.score!) || 0) - (parseFloat(a.score!) || 0) ||
      riskRank(b.risk!) - riskRank(a.risk!)
    );
    lines.push(`## STRIDE Threat Matrix\n`);
    lines.push(`| ID | Categories | Risk | Score | Location | Description |`);
    lines.push(`|---|---|---|---|---|---|`);
    strideThreats.forEach((t, i) => {
      lines.push(
        `| T-${i + 1} | **${t.cats}** | ${riskEmoji(t.risk!)} ${mdCell(t.risk!)} | ${t.score} | ${mdCell(t.from!)} &rarr; ${mdCell(t.to!)} | ${mdCell(t.desc!)} |`,
      );
    });
    lines.push("");
  }

  const globalNonStride = getList(d.attrs.threats).map(String)
    .map((t) => parseThreat(t)).filter((t) => !t.isStride);
  if (globalNonStride.length > 0) {
    lines.push(`## Global Threats`);
    globalNonStride.forEach((t) => lines.push(`- **${mdText(t.raw)}**`));
    lines.push("");
  }

  lines.push(`## Data Flows\n`);
  d.flows.forEach((f, index) => {
    const fromName = nameOf(f.from), toName = nameOf(f.to);
    const op = str(f.attrs.operation) || "Flow";

    lines.push(
      `### ${index + 1}. ${mdText(fromName)} -> ${mdText(toName)}: ${mdText(op)}`,
    );

    const data = getList(f.attrs.data).map(String);
    if (data.length > 0) {
      lines.push(`- **Data Exchanged:** ${mdText(data.join(", "))}`);
    }

    const fThreats = getList(f.attrs.threats).map(String).map((t) =>
      parseThreat(t)
    );
    if (fThreats.length > 0) {
      lines.push(`- **Identified Threats:**`);
      fThreats.forEach((t) => {
        if (t.isStride) {
          lines.push(
            `  - ${riskEmoji(t.risk!)} **[${mdText(t.risk!)}]** **[${t.cats}]** (Score: ${t.score}) - ${mdText(t.desc!)}`,
          );
        } else {
          lines.push(`  - ${mdText(t.raw)}`);
        }
      });
    }

    const fDesc = str(f.attrs.description);
    if (fDesc) lines.push(`\n**Description:**\n${fDesc}\n`);
    else lines.push("");
  });

  if (explain) lines.push(`\n${strideLegendMarkdown()}\n`);

  return lines.join("\n");
}

export function render(d: Diagram, dataflow: boolean, explain = false): string {
  const lines: string[] = [];
  const title = str(d.attrs.title);
  const diagramExtra = extras(d.attrs, ["title", "threats"]);

  if (dataflow) {
    // ----------------------------------------------------
    // Graphviz DFD Rendering
    // ----------------------------------------------------
    let dfdFlowIndex = 1;
    lines.push("digraph G {");
    lines.push("  rankdir=TB;");

    lines.push('  graph [fontname="Helvetica"];');
    lines.push('  node [fontname="Helvetica", shape="box", style="solid"];');
    lines.push('  edge [fontname="Helvetica", fontsize=11];');

    if (title) {
      lines.push(`  labelloc="t";`);
      lines.push(`  label="${gv(title)}";`);
      lines.push(`  fontsize=18;`);
    }

    if (explain) {
      const legendRows = STRIDE_LEGEND.map(([letter, desc]) => {
        const idx = desc.indexOf(":");
        const meaning = idx >= 0 ? desc.slice(0, idx) : desc;
        const detail = idx >= 0 ? desc.slice(idx + 1).trim() : "";
        return `<TR><TD><B>${letter}</B></TD><TD>${gv(meaning)}</TD><TD>${gv(detail)}</TD></TR>`;
      }).join("");
      lines.push(`  graph [fontname="Helvetica", fontsize=9, labelloc="b", labeljust="r", label=<<TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="4" BGCOLOR="#FFFFFF"><TR><TD COLSPAN="3" BGCOLOR="#F3F4F6"><FONT POINT-SIZE="12"><B>STRIDE</B></FONT></TD></TR>${legendRows}</TABLE>>];`);
    }

    // IDs are quoted so that ones like "node", "edge" or "graph" (Graphviz
    // keywords) are still valid.
    const node = (n: Node) => {
      const name = label(n.attrs, n.id);
      if (n.kind === "database") {
        lines.push(
          `  "${n.id}" [shape=none, margin=0, label=<<table border="0" cellborder="1" cellspacing="0" cellpadding="6"><tr><td sides="TB" bgcolor="#CD3B48" color="#982C35"><font face="Helvetica" color="white">${gv(name)}</font></td></tr></table>>];`,
        );
      } else if (n.kind === "io") {
        lines.push(
          `  "${n.id}" [label="${gv(name)}", shape="box", style="filled,solid", fillcolor="#989898", color="#CD3B48", fontcolor="white"];`,
        );
      } else {
        lines.push(
          `  "${n.id}" [label="${gv(name)}", shape="circle", style="filled,solid", fillcolor="#E2EAF9", color="#A9B8D6"];`,
        );
      }
    };

    for (const b of d.boundaries) {
      lines.push(`  subgraph "cluster_${b.id}" {`);
      lines.push(`    label="${gv(label(b.attrs, b.id))}";`);
      lines.push(`    style="dashed,filled";`);
      lines.push(`    fillcolor="#F9F9F9";`);
      lines.push(`    color="#777777";`);
      lines.push(`    fontcolor="#777777";`);
      for (const n of d.nodes.filter((n) => n.boundary === b.id)) node(n);
      lines.push(`  }`);
    }

    for (const n of d.nodes.filter((n) => !n.boundary)) node(n);

    const getKind = (id: string) =>
      d.nodes.find((n) => n.id === id)?.kind || "function";
    const getRank = (kind: string) =>
      kind === "io" ? 1 : kind === "function" ? 2 : 3;
    const seenAsSource = new Set<string>();

    for (const f of d.flows) {
      const opList = getList(f.attrs.operation).map(String);
      const dataList = getList(f.attrs.data).map(String);
      const fThreats = getList(f.attrs.threats).map(String).map((t) =>
        parseThreat(t)
      );

      const strideTags = fThreats.filter((t) => t.isStride).map((t) =>
        `<font face="Helvetica" color="${getRiskColorGV(t.risk!)}"><b>[${gv(t.cats!)}]</b></font>`
      );

      let htmlLabel = "";
      // Escape every row first, then add the numbering prefix to the first
      // one, so the prefix markup is never escaped itself.
      const rows = [...opList, ...dataList].map(gv);
      if (rows.length > 0 || strideTags.length > 0) {
        if (rows.length > 0) {
          rows[0] = `<font color="#3182ce">(${dfdFlowIndex})</font> ${rows[0]}`;
          dfdFlowIndex++;
        }

        let tableRows = rows.map((c) =>
          `<tr><td><font face="Helvetica">${c}</font></td></tr>`
        ).join("");
        if (strideTags.length > 0) {
          tableRows += `<tr><td>${strideTags.join(" ")}</td></tr>`;
        }
        htmlLabel =
          `<<table border="0" cellborder="0" cellpadding="2">${tableRows}</table>>`;
      }

      const fromRank = getRank(getKind(f.from));
      const toRank = getRank(getKind(f.to));

      const constraint = (fromRank > toRank || seenAsSource.has(f.to))
        ? ", constraint=false"
        : "";
      seenAsSource.add(f.from);

      lines.push(
        `  "${f.from}" -> "${f.to}" [label=${htmlLabel || '""'}${constraint}];`,
      );
    }

    lines.push("}");
    return lines.join("\n") + "\n";
  } else {
    // ----------------------------------------------------
    // PlantUML Sequence Rendering
    // ----------------------------------------------------
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

    const formatFlowText = (
      opV: Value | undefined,
      dataV: Value | undefined,
    ): string => {
      let opList = getList(opV).map(String);
      let dataList = getList(dataV).map(String);

      opList = opList.map((o) => `**<color:#444444>${pu(o)}</color>**`);
      dataList = dataList.map((d) => `//<color:#666666>${pu(d)}</color>//`);
      return [...opList, ...dataList].filter(Boolean).join("\\n");
    };

    // Aliases are prefixed so IDs that collide with PlantUML keywords
    // (e.g. "end", "note", "title") are still valid.
    const alias = (id: string) => `n_${id}`;

    const defineSeqNode = (n: Node) => {
      const name = label(n.attrs, n.id);
      const kind = n.kind === "database"
        ? "database"
        : n.kind === "io"
        ? "entity"
        : "participant";
      lines.push(`  ${kind} "**${pu(name)}**" as ${alias(n.id)}`);
    };

    for (const b of d.boundaries) {
      lines.push(
        `  box "<color:#666666><i>${pu(label(b.attrs, b.id))}</i></color>" #F9F9F9`,
      );
      for (const n of d.nodes.filter((n) => n.boundary === b.id)) {
        defineSeqNode(n);
      }
      lines.push(`  end box`);
    }

    for (const n of d.nodes.filter((n) => !n.boundary)) defineSeqNode(n);

    for (const n of d.nodes) {
      const x = extras(n.attrs, ["title"]);
      if (x.length) {
        lines.push(`  note over ${alias(n.id)}: ${pu(x.join(" | "))}`);
      }
    }

    for (const f of d.flows) {
      let text = formatFlowText(f.attrs.operation, f.attrs.data);
      if (!text) text = pu("Flow");

      const a = alias(f.from), b = alias(f.to);
      lines.push(`  ${a} -> ${b}: ${text}`);

      const desc = str(f.attrs.description),
        x = extras(f.attrs, ["operation", "data", "description", "threats"]);

      if (desc || x.length) {
        lines.push(
          `  note over ${a},${b}: ${pu([desc, ...x].filter(Boolean).join(" | "))}`,
        );
      }

      const strideThreats = getList(f.attrs.threats).map(String).map((t) =>
        parseThreat(t)
      ).filter((t) => t.isStride);
      if (strideThreats.length > 0) {
        // Colour the note by the most severe threat, not the first listed.
        const worst = strideThreats.reduce((w, t) =>
          riskRank(t.risk!) > riskRank(w.risk!) ? t : w
        );
        const color = getRiskColorPUML(worst.risk!);
        const threatLines = strideThreats.map((t) =>
          `**[${pu(t.cats!)}] ${pu(t.risk!)} (${pu(t.score!)})**\\n${pu(t.desc!)}`
        ).join("\\n---\\n");
        lines.push(`  note over ${a},${b} ${color}: ${threatLines}`);
      }
    }

    if (explain) {
      lines.push("legend right");
      STRIDE_LEGEND.forEach(([letter, desc]) => {
        const idx = desc.indexOf(":");
        const meaning = idx >= 0 ? desc.slice(0, idx) : desc;
        lines.push(`${letter} = ${meaning} - ${idx >= 0 ? desc.slice(idx + 1).trim() : ""}`);
      });
      lines.push("endlegend");
    }

    if (diagramExtra.length) {
      lines.push(`' Diagram attributes: ${diagramExtra.map(clean).join(" | ")}`);
    }

    lines.push("@enduml");
    return lines.join("\n") + "\n";
  }
}

export function shouldSkipOutput(
  input: string,
  output: string,
  force = false,
): boolean {
  if (force) return false;

  try {
    const src = Deno.statSync(input);
    const dst = Deno.statSync(output);
    if (src.mtime && dst.mtime) {
      return dst.mtime.getTime() > src.mtime.getTime();
    }
  } catch {
    // Ignore missing files or unreadable metadata; the generator will run.
  }
  return false;
}

function usage() {
  return `Usage: dataflow.ts SOURCE.flow --output FILE [OPTIONS]\n\nOptions:\n  -o, --output FILE  Required output file (.png/.svg for images; .md for reports)\n  -d, --dataflow     Data-flow diagram (Graphviz) instead of default sequence diagram (PlantUML)\n  -r, --report       Generate a Markdown threat model report instead of an image\n  -e, --explain      Add a STRIDE explanation/legend to the output\n  -f, --force        Regenerate output even when it is newer than the source\n  -h, --help         Show this help\n`;
}

async function main() {
  const args = Deno.args;
  let input = "", output = "", dataflow = false, report = false, force = false, explain = false;

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
    if (a === "-e" || a === "--explain") {
      explain = true;
      continue;
    }
    if (a === "-f" || a === "--force") {
      force = true;
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

  if (shouldSkipOutput(input, output, force)) {
    console.log(`Skipping ${output}: output is newer than ${input}. Use --force to regenerate.`);
    return;
  }

  const source = await Deno.readTextFile(input);
  const d = new Parser(lex(source)).parse();

  for (const w of validateThreats(d)) console.error(`dataflow: warning: ${w}`);

  if (report) {
    const mdText = generateReport(d, explain);
    await Deno.writeTextFile(output, mdText);
    console.log(`Wrote ${output}`);
    return;
  }

  const text = render(d, dataflow, explain);
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
    const cmdArgs = dataflow
      ? [`-T${ext}`, path, "-o", output]
      : [`-t${ext}`, path];

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
