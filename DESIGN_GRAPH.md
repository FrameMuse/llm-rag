# Knowledge Graph — design & plan

## Why a knowledge graph?

Vector RAG answers "what is this?" — semantic similarity over chunks. A knowledge graph answers "how does this connect?" — structural relationships between code entities. Together they give the full picture.

For a codebase, vector search finds relevant chunks about `createNode`, but the graph shows:

```
Node ← createNode (factory)
Node → FrameNode → RectangleNode (extends)
FrameNode ← addChild(children) (method)
createNode ← nodeFactory (caller)
Document → PageNode → SceneNode → Node (inheritance)
```

These relationships are spread across many files — no single chunk captures the full architecture. The graph does.

---

## 1. Data model

```typescript
interface GraphNode {
  id: string            // "SceneNode" | "src/pages/Nodes.ts:createNode"
  type: "class" | "interface" | "function" | "type" | "enum" | "const" | "file"
  file: string          // relative path
  name: string          // display name
}

interface GraphEdge {
  source: string        // node id
  target: string
  type: string          // "extends" | "implements" | "imports" | "calls" | "creates" | "defines"
}

class KnowledgeGraph {
  nodes: Map<string, GraphNode>
  edges: Map<string, GraphEdge[]>   // adjacency list
  // source -> edges
}
```

Edge types extracted from AST:

| Edge type | Source | Target | Example |
|-----------|--------|--------|---------|
| `extends` | Class | Class | `SceneNode extends BaseNode` |
| `implements` | Class | Interface | `FrameNode implements ILayout` |
| `imports` | File | File | `CanvasDraw.ts imports Vector2.ts` |
| `imports` | File | Symbol | `CanvasDraw.ts imports "Vector2"` |
| `defines` | File | Symbol | `CanvasDraw.ts defines function render()` |
| `calls` | Function | Function | `render() calls clearCanvas()` |
| `contains` | Class | Method | `ComponentNode contains render()` |
| `belongs` | Symbol | Module | `render belongs to CanvasDraw` |

---

## 2. Extraction pipeline

### Phase A: Build (one-time, after index)

```
rag graph build
```

Reads `.rag/data/graph.json`. If exists, incremental update. Otherwise full build:

```
for each indexed .ts/.js file:
  parse with ts.createSourceFile (already done in chunkTsFile)
  extract:
    - all top-level declarations → nodes + "defines" edges
    - heritage clauses → "extends" / "implements" edges
    - import declarations → "imports" edges
    - function/class bodies → "calls" edges (deep walk)
    - class members → "contains" edges

store as .rag/data/graph.json
```

Reuses the same TypeScript AST that `chunkTsFile` already parses. No new file I/O — source text is already in memory during indexing.

### Phase B: Incremental (during watch mode)

When a file changes in `--watch` mode, the graph is updated for just that file:

```
on file change:
  delete all edges where source or target file == changed file
  re-parse file
  insert new edges
  write graph.json
```

---

## 3. Graph queries

Exposed via `rag mcp graph <subcommand>`:

| Subcommand | Input | Output | Use case |
|-----------|-------|--------|----------|
| `neighbors <node>` | Node name | Direct connections + edge types | "What does `CanvasDraw` connect to?" |
| `path <from> <to>` | From node, to node | Shortest connection path | "How does `handleClick` reach `saveFile`?" |
| `hubs [N]` | (optional) top N | Highest-degree nodes | "What are the core modules?" |
| `calls <function>` | Function name | All callers + callees | "Who calls `renderCanvas`?" |
| `community <node>` | Node name | All nodes in same Leiden-clustered group | "What's in the rendering module?" |
| `find <text>` | Search text | Nodes matching name/type | "Find all factory functions" |

### Auto-query via `--graph` flag

When `rag mcp query "question" --graph`:

```
1. Ask RAG model: "Given this question, what graph queries would help answer it?
   Return as JSON: { queries: [{ type: "neighbors", args: ["Node"] }, ...] }"

2. Execute each graph query

3. Format results as text block:

   [Graph: CanvasDraw]
   - neighbors: CanvasEditor, CanvasEvents, render, clearCanvas
   - callers: AppRoot, EventLoop
   - extends: BaseModule
   - contained in: src/modules/engine/CanvasDraw.ts

4. Prepend to vector search context:

   === Graph Context ===
   [Graph connections for "create node"]
   ...

   === Document Context ===
   [1] api/figma.md > createNode
   ...

5. LLM synthesizes both → answer
```

The LLM sees the graph data as formatted text — no special model needed. Graph is just structured knowledge injected into the prompt.

---

## 4. Files to create

| File | Purpose |
|------|---------|
| `src/core/graph.ts` | `KnowledgeGraph` class: addNode, addEdge, build from AST, save/load JSON, query methods |
| `src/commands/graph.ts` | `rag graph build`, `rag mcp graph <subcommand>` CLI handlers |

## Files to modify

| File | Change |
|------|--------|
| `src/core/chunker.ts` | `chunkTsFile` — also return extracted edges alongside chunks (optional, for single-pass build during index) |
| `src/mcp/handlers.ts` | `handleQuery` — if `--graph`, call LLM for query generation, execute graph queries, prepend to context |
| `src/commands/mcp.ts` | Parse `--graph` flag |
| `scripts/cli.ts` | Add `graph` command to help text |

## Files unchanged

Everything else — search, index, serve, config, store, vision, tests — stays identical.

---

## 5. Implementation order

| Step | What | Files | Effort |
|------|------|-------|--------|
| 1 | `KnowledgeGraph` class + save/load JSON | `graph.ts` | Small |
| 2 | Extract nodes + edges from AST | `graph.ts` + `chunker.ts` | Medium |
| 3 | `rag graph build` command | `commands/graph.ts` | Small |
| 4 | Graph query subcommands (neighbors, path, hubs, find) | `commands/graph.ts` | Medium |
| 5 | `--graph` flag: LLM generates queries, merges context | `handlers.ts`, `mcp.ts` | Medium |
| 6 | Incremental update during watch mode | `index.ts`, `graph.ts` | Small |

---

## 6. Edge cases

| Case | Handling |
|------|----------|
| No `.ts` files in project | Graph is empty, `--graph` shows warning |
| Circular imports | BFS path search terminates at visited nodes |
| Graph file missing | `rag graph build` auto-runs if missing when `--graph` used |
| Large graph (10k+ nodes) | Efficient with Map adjacency list, path search under 1ms |
| File renamed/deleted | Incremental update removes stale edges |

---

## 7. Open questions

1. Call graph extraction requires deep AST walk of function bodies. Should we do this, or start with import/class hierarchy only (70% value, 20% effort)?
2. Stored separately from LanceDB in `.rag/data/graph.json`. Should it be rebuilt on `rag index` automatically, or only on explicit `rag graph build`?
3. `--graph` generates extra LLM calls for query planning. Should this cost (latency + tokens) be opt-in via the flag?
