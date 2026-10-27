# DataFlow converter (`dataflow.ts`)

A standalone Deno TypeScript converter for the [Sony Xperia DataFlow language](https://github.com/sonyxperiadev/dataflow). It produces PlantUML (Sequence Diagrams), native Graphviz (Data Flow Diagrams), or Markdown threat model reports, and can invoke locally installed tools to render PNG or SVG images.

Initially I used ChatGPT to build a version of this script but then moved to Google Gemini.

## Install on macOS

```sh
brew install deno plantuml graphviz
```

`plantuml` uses Java and Graphviz as needed; Homebrew resolves its formula dependencies. `graphviz` provides the `dot` command for rendering the Data Flow Diagrams. Confirm the commands are on your `PATH`:

```sh
deno --version
plantuml -version
dot -version
```

*(Note: If you are running tools in a containerized environment like OrbStack or Docker, ensure your wrapper scripts for `plantuml` and `dot` are executable and accessible in `/usr/local/bin/`)* or `$HOME/bin`.

Make the script executable:

```sh
chmod +x dataflow.ts
```

Text output requires only Deno; image output additionally requires the relevant renderer.

## Command-line interface

```text
./dataflow.ts SOURCE.flow --output FILE [OPTIONS]
```

| Flag | Meaning |
| --- | --- |
| `SOURCE.flow` | Required positional source file |
| `-o`, `--output FILE` | Required destination filename |
| `-d`, `--dataflow` | Data-flow/flowchart layout via Graphviz (default: PlantUML sequence) |
| `-r`, `--report` | Generate a Markdown threat model report instead of an image |
| `-h`, `--help` | Show help |

Output extensions `.png` and `.svg` (case-insensitive) trigger image rendering. All other extensions (`.puml`, `.dot`, `.txt`, etc.) produce plain text in the selected diagram language. The extension of a text file does not choose the diagram language.

see `./build_examples.sh` for examples of how to use this script

Alternatively, `deno run --allow-read --allow-write --allow-run dataflow.ts ...` works without making the script executable. Image rendering launches local commands; it does not contact a rendering service.

## The DataFlow Language (`.flow`)

DataFlow is a declarative Domain-Specific Language (DSL) originally designed for "Threat Modeling as Code". It allows developers to define system architectures and data exchanges in plain text, which can then be compiled into visual diagrams and security reports.

### Syntax Rules
*   **Blocks:** Structural elements and properties are scoped using curly braces `{}`.
*   **Attributes:** Key-value assignments use the equals sign (`=`).
*   **Strings:** Use double quotes (`"..."`) for single lines.
*   **Multiline Text:** Use backticks (`` `...` ``) for paragraphs.
*   **Arrays:** Use brackets (`["A", "B"]`) for lists of items (like data payloads or threats).
*   **Comments:** C-style multiline comments (`/* ... */`) are ignored by the parser. This converter also accepts `// ...` line comments (a convenience extension; other tools that read `.flow` files may not).

### Core Components

Everything in a `.flow` file must be enclosed within a root `diagram` block:

```text
diagram {
  title = "My System"
  
  // Nodes, boundaries, and flows go here...
}
```

#### 1. Nodes
Nodes represent the entities in your architecture. There are three specific types:
*   `function`: Active processing logic (e.g., a web server, an API, a microservice).
*   `database`: Passive data storage (e.g., SQL, Redis, file systems).
*   `io`: External actors or systems outside your direct control (e.g., users, browsers, third-party APIs).

Define a node by declaring its type, giving it a unique ID, and assigning it a human-readable title:
```text
function my_api {
  title = "Authentication API"
}
database user_db {
  title = "User Credentials"
}
```

#### 2. Boundaries
Boundaries group nodes into logical or physical security zones (e.g., AWS, On-Premises, Client Device). Nodes defined inside a boundary belong to that zone.
```text
boundary aws_cloud {
  title = "Amazon Web Services"
  
  function worker { title = "Background Worker" }
  database queue { title = "SQS Queue" }
}
```

#### 3. Flows
Flows define how data moves between nodes. They are defined using directional arrows (`->` or `<-`) referencing the unique IDs of the nodes. Flows carry attributes detailing what is happening.
```text
my_api -> user_db {
  operation = "SQL Insert"
  data = [
    "Username",
    "Hashed Password"
  ]
  description = `The API persists the new user credentials.`
  threats = ["SQL Injection"]
}
```

### Example

See `examples/simple.flow` (minimal), `examples/complex.flow` and `examples/stride.flow` (STRIDE threat annotations). Another minimal complete example:

```text
diagram {
  title = "Ordering"
  
  boundary storefront {
    title = "Storefront"
    io shopper { title = "Customer" }
    function api { title = "Order API" }
  }
  
  database orders { title = "Orders" }
  
  shopper -> api {
    operation = "Place order"
    data = ["Order details"]
    description = `Validate the incoming order
                   and acknowledge receipt.`
  }
  
  api -> orders { 
    operation = "Save" 
    data = ["Order"] 
  }
}
```

## Threat modelling with STRIDE

`threats` entries (on the `diagram` or on any flow) can be plain strings, or STRIDE-annotated strings in this format:

```text
"[CATEGORIES] [Risk] [Score] Description"
```

```text
threats = [
  "[S, I] [Critical] [9.2] Credential stuffing against the login portal.",
  "[D] [Medium] Application layer DoS on the login route"
]
```

*   **Categories** - one or more STRIDE letters, comma separated (case-insensitive):

    | Letter | Threat | Violates |
    | --- | --- | --- |
    | `S` | Spoofing | Authenticity |
    | `T` | Tampering | Integrity |
    | `R` | Repudiation | Non-repudiation |
    | `I` | Information disclosure | Confidentiality |
    | `D` | Denial of service | Availability |
    | `E` | Elevation of privilege | Authorisation |

*   **Risk** - `Critical`, `High`, `Medium` or `Low` (case-insensitive). Any other value is accepted but shown in neutral grey and reported as a warning.
*   **Score** - optional number such as `8.5` (for example a CVSS or DREAD-style score). It is only treated as a score when it is numeric; if omitted it shows as `N/A`.
*   **Description** - free text. It may span several lines when written as a backtick string.

A threat that does not match this shape is kept as plain text. A plain-text threat that *starts* with `[` triggers a warning, because it usually means a typo in a STRIDE annotation.

### Where STRIDE threats appear

| Output | What you get |
| --- | --- |
| Markdown report (`--report`) | A **STRIDE Threat Matrix** table (ID, categories, risk, score, location, description) sorted by score, highest first (ties broken by risk), followed by each flow's threats. Plain-text diagram-level threats are listed under **Global Threats**. |
| Data-flow diagram (`-d`) | The STRIDE category tags (for example **[S, I]**) under the flow's label, coloured by risk. Descriptions and scores are not drawn; see the report for those. |
| Sequence diagram (default) | A note on the flow listing each threat's categories, risk, score and description. The note is coloured by the **most severe** threat on that flow. |

| Risk | Report | Diagram colour | Sequence note |
| --- | --- | --- | --- |
| Critical | 🔴 | `#982C35` | `#FFB3B3` |
| High | 🟠 | `#CD3B48` | `#FFCCCC` |
| Medium | 🟡 | `#D97706` | `#FFE6CC` |
| Low | 🟢 | `#059669` | `#E6FFCC` |
| Other | ⚪ | `#444444` | `#EEEEEE` |

### Warnings

Malformed threats do not stop the conversion. Instead the converter prints warnings to stderr, for example an unknown STRIDE letter, an unknown risk level, or a threat that looks like STRIDE but cannot be parsed. Diagram-level STRIDE threats have no flow, so their location is shown as *Global → Architecture* in the matrix.

See `examples/stride.flow` and the generated `examples/stride-report.md`.

## Attribute mapping

| Source element | Sequence output (PlantUML) | Data-flow output (Graphviz) | Markdown Report |
| --- | --- | --- | --- |
| `diagram.title` | Diagram title | Graphviz label | Report H1 Header |
| `boundary.title` | Enclosing Box | Subgraph cluster | N/A |
| `io` | Entity (Circle on line) | Box | Node reference |
| `function` | Participant | Circle | Node reference |
| `database` | Database (Red Cylinder) | Gane-Sarson Table | Node reference |
| `flow.operation` | Bold message text | Auto-numbered edge label | Data flow header |
| `flow.data` | Italicized gray text below message | Appended to edge label | Bulleted list item |
| `flow.description` | Inline note over endpoints | Ignored visually | Rendered Markdown block |
| `flow.threats` | Note on the flow (STRIDE-formatted threats only) | Category tags under the label (STRIDE-formatted threats only) | Matrix row (STRIDE) and bulleted list |
| `diagram.threats` | Ignored visually | Ignored visually | Matrix row (STRIDE) or Global Threats list (plain text) |

Attributes not directly representable in a target visual format are retained as human-readable annotations in the Markdown report, not as native renderer semantics. Nested array values are represented as JSON strings. `description` is not rendered visually in data-flow mode: it is intended for the Markdown report. In the report, angle brackets in titles, operations, data and threat text are escaped so they appear literally, while `description` is passed through as Markdown. Comments from the original `.flow` file are not preserved.

## Visual styling & Layout behavior

*   **HTML Text Formatting:** Graphviz labels for operations and data fully support subset HTML. Tags like `<sub>`, `<sup>`, `<b>`, and `<i>` will pass through the parser and render natively in Data Flow Diagrams.
*   **DFD Layout Hierarchy:** Data-flow layout forces a logical top-to-bottom hierarchy (`rankdir=TB`). The script enforces structure by mapping IOs to the top, Functions to the middle, and Databases to the bottom. Back-edges (arrows creating cycles) are automatically de-prioritized to maintain visual flow.
*   **Sequence Styling:** The sequence mode maps colors explicitly to match the original Sony rose/blue/gray theme. Boundaries render as explicitly shaded grouping boxes (`box ... end box`) rather than notes.

## Limitations and design choices

*   Strings follow the upstream language's no-escape rule; no backslash escaping is supported in quoted source strings.
*   Target diagram syntax has restrictions on punctuation in labels; this converter normalizes several problematic characters (e.g., escaping `<` and `>` where HTML is not supported). Check generated diagrams for unusually complex labels.
*   Node and boundary IDs are quoted in the Graphviz output and prefixed in the PlantUML output, so IDs such as `node`, `edge` or `end` are safe.
*   The program needs write access to the destination directory and temporary directory. Renderer failures are reported on stderr with a nonzero exit code.

## Troubleshooting

If `plantuml` or `dot` is missing, install it with Homebrew (or verify your Docker wrappers) and check `PATH`. If an image fails to render, first generate `.puml` or `.dot` text and inspect the result. Warnings about threats are printed on stderr and never change the exit code.

## References

*   [Sony Xperia DataFlow language](https://github.com/sonyxperiadev/dataflow)
*   [PlantUML](https://plantuml.com/)
*   [Graphviz](https://graphviz.org/)