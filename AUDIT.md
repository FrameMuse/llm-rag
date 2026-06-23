# rag — code audit & improvement roadmap

Audit date: 2026-06-23

---

## Critical bugs

### 1. `rag serve --watch` is dead code

`src/commands/serve.ts:13-28`

`startMcpServer(ragDir)` connects via `StdioServerTransport` and enters an event loop that never returns. All chokidar setup after this call is unreachable. The `--watch` flag on `serve` has zero effect.

**Fix:** Move chokidar setup before `startMcpServer`, or start watcher in a separate process/thread.

---

### 2. Path traversal in `get-document`

`src/mcp/handlers.ts:187-190`

```ts
const fullPath = resolve(projectDir, path)
return readFileSync(fullPath, "utf-8")
```

No check that `fullPath` stays within `projectDir`. Caller can request `../../etc/passwd`. Exposed via both MCP and CLI.

**Fix:** Verify `relative(projectDir, fullPath)` does not start with `..`.

---

### 3. CLI search query includes `--limit` flag text

`src/commands/mcp.ts:29`

```ts
const query = args.slice(1).join(" ")   // includes --limit N
```

`rag mcp search foo --limit 5` searches for `"foo --limit 5"` instead of `"foo"`.

**Fix:** Filter out `--limit` and its value before joining.

---

### 4. H1 headings ignored

`src/core/chunker.ts:17`

```ts
const HEADING_RE = /^(#{2,4})\s+(.+)$/gm   // only ## through ####
```

Level-1 headings (`# Title`) are never recognized. Their content is silently dropped or merged into wrong sections.

**Fix:** Change to `#{1,6}`.

---

### 5. `rag init` overwrites existing config

`src/commands/init.ts:23`, `src/core/config.ts:63`

Running `rag init` again in an initialized directory resets `embedModel`, `ragModel`, `pattern` to defaults, and overwrites `mcp.json`.

**Fix:** Skip if `.rag/` already exists, or merge with existing config.

---

### 6. Missing `ensureModel` for embedding model in query/search

`src/mcp/handlers.ts:84,100`

`handleQuery` calls `ensureModel(config.ragModel)` but never checks `config.embedModel`. `handleSearch` calls neither. If the embedding model was never pulled, Ollama returns a confusing error instead of auto-pulling.

**Fix:** Add `ensureModel(config.embedModel)` before first `embed()` call in both handlers.

---

## Logic errors

| # | Issue | File | Detail |
|---|-------|------|--------|
| 7 | Section-skip corrupts heading hierarchy | `chunker.ts:150-155` | `continue` bypasses `lastH1`/`lastH2` updates; nested headings get wrong parent |
| 8 | Text chunker token estimate uses compact form, content uses pretty-printed | `chunker.ts:298-299` | `JSON.stringify(key, null, 2)` content but `JSON.stringify(key)` in token estimate — mismatch |
| 9 | Dead no-op code for last short declaration | `chunker.ts:236-238` | `content = sourceText.slice(d.start, d.end)` reassigns same value |
| 10 | FTS error catch silently swallows all errors | `store.ts:67-71` | Disk full, permission denied, corruption all treated as "already exists" |
| 11 | No deduplication on re-index | `store.ts:63` | `addChunks` can create duplicate chunks if `deleteChunksForFile` wasn't called |
| 12 | Last declaration <50 chars is always included | `chunker.ts:236` | Last element has no minimum size enforcement |

---

## Design weaknesses

| # | Issue | File | Impact |
|---|-------|------|--------|
| 13 | `process.exit()` in library code | `config.ts`, `embedder.ts`, `ragdir.ts` | Makes code untestable, kills host when used programmatically |
| 14 | Synchronous I/O (`readFileSync`) in all chunkers | `chunker.ts` | Blocks event loop during indexing |
| 15 | No embedding backend abstraction | `embedder.ts` | Ollama hardcoded — can't swap to OpenAI, local HF, etc. |
| 16 | Ollama host hardcoded | `embedder.ts:1` | No `OLLAMA_HOST` env var support |
| 17 | No HTTP timeouts | `embedder.ts:15-21` | CLI hangs forever if Ollama hangs |
| 18 | Glob fallback broken for complex patterns | `chunker.ts:82` | `--pattern "src/**/*.tsx"` matches any `.tsx` anywhere |
| 19 | No retry on transient Ollama errors | `embedder.ts` | 503 or network blip kills the operation |
| 20 | LanceDB connection created per request | `handlers.ts` | No connection pooling |
| 21 | No streaming of large results | `server.ts` | Search results returned as single massive JSON string |
| 22 | No graceful shutdown | `server.ts`, `index.ts` | Ctrl+C can corrupt LanceDB |
| 23 | No debounce in watch mode | `index.ts` | Rapid file changes fire multiple re-indexes |

---

## Performance bottlenecks

| # | Issue | Detail |
|---|-------|--------|
| 24 | All chunks loaded into memory before indexing | 3 large arrays (~50k objects each) simultaneously |
| 25 | Token estimation is naive (`length/3` or `length/4`) | Doesn't account for CJK, inconsistent between files |
| 26 | `walkFiles` traverses synchronously | Blocks event loop on large trees |
| 27 | No incremental re-index in watch mode | Re-reads+re-embeds entire file on every change |
| 28 | `listDocumentPaths` has arbitrary 100k limit | Collections >100k docs silently truncated |

---

## Edge cases not handled

- Zero files found, empty search query, zero-length files
- Malformed markdown, JSON, TypeScript
- Binary files with supported extensions (`.html` that is actually binary)
- Unicode BOM, symlink loops, non-UTF-8 content
- Ollama running but model pull fails (no disk space, no internet)
- Two simultaneous `rag index` on same `.rag/` directory
- `.rag/` is a file instead of a directory
- MCP client disconnects abruptly
- SIGINT during `writeConfig` or `table.add`

---

## Code quality

- `any` casts throughout (`(Bun as any).Glob`, `Record<string, unknown>` abuse)
- Inconsistent error handling (some `throw`, some `process.exit`, some return error in result)
- Mixed logging destinations (stdout, stderr, process.stdout.write)
- Dead code: `embed()` function never called, `@cfworker/json-schema` unused
- Import style inconsistencies (dynamic vs static, inline type annotations)
- Missing type definitions (`@types/chokidar`, `@types/gray-matter`)

---

## Small improvements

- `--watch` flag is fragile — `args.includes("--watch")` matches `--watchdog`, `--watch-only`
- No `--version` flag
- ProgressBar has no ETA, no clearing, breaks at `total=0`
- No validation for config fields (empty model name, invalid glob)
- FTS index creation should be configurable
- MCP server version hardcoded instead of read from package.json
- Chunk overlap would reduce context loss at boundaries
- Large JSON arrays could be chunked by element
- Binary file detection (null bytes / non-UTF-8) would prevent silent failures
- Retry with exponential backoff for Ollama calls
- Parameterized queries for `deleteChunksForFile` instead of string interpolation
- `_score` should also be in `searchTable` results (not just `hybridSearchTable`)
- Request logging to stderr in MCP server
- Path sanitization for `get-document`

---

## Architectural (long-term)

- Abstract embedding backend (interface for Ollama, OpenAI, local models)
- Test suite (handler unit tests, integration tests with local Ollama)
- Typed interfaces for LanceDB records instead of `Record<string, unknown>`
- Config versioning and migration system
- Changelog/file filtering for RAG context
- tree-sitter support for non-TypeScript languages (Python, Rust, Go)
