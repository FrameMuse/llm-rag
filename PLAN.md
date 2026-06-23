# rag — implementation plan

Phased approach. Each phase is self-contained, no file is touched by more than 2 phases.

---

## Phase 1 — Bug fixes (6 items, 1 file each, no deps)

| # | Fix | File | Line | Change |
|---|-----|------|------|--------|
| 4 | H1 headings ignored | `chunker.ts` | 17 | `#{2,4}` → `#{1,6}` |
| 7 | Heading hierarchy corruption | `chunker.ts` | 150-155 | Move `lastH1`/`lastH2` updates before `continue` |
| 8 | Token estimate mismatch | `chunker.ts` | 298-299 | Use same divisor for JSON content and estimate |
| 3 | CLI search includes `--limit` | `mcp.ts` | 29 | Filter `--limit` and its value before joining args |
| 2 | Path traversal in get-document | `handlers.ts` | 187-190 | Verify `relative(projectDir, fullPath)` doesn't start with `..` |
| 6 | Missing `ensureModel` for embed model | `handlers.ts` | 84, 100 | Add `ensureModel(config.embedModel)` before first embed call |

---

## Phase 2 — Robustness (7 items)

| # | Fix | Files | Approach |
|---|-----|-------|----------|
| 1 | serve --watch is dead code | `serve.ts` | Move chokidar setup before `startMcpServer` |
| 5 | rag init overwrites config | `init.ts`, `config.ts` | Skip if `.rag/config.json` exists |
| 10 | FTS error swallows all errors | `store.ts` | Log error, suppress only "already exists" |
| 16 | Ollama host hardcoded | `embedder.ts` | `process.env.OLLAMA_HOST ?? "http://localhost:11434"` |
| 17 | No HTTP timeouts | `embedder.ts` | `AbortSignal.timeout(30000)` on all fetches |
| 13 | process.exit in library code | `config.ts`, `embedder.ts`, `ragdir.ts` | Throw typed errors instead, CLI handles exit |
| 11 | No dedup on re-index | `store.ts`, `index.ts` | Always delete existing chunks for each file before add |

---

## Phase 3 — Watch mode + lifecycle (3 items)

| # | Fix | Files | Approach |
|---|-----|-------|----------|
| 22 | Graceful shutdown | `server.ts`, `index.ts` | SIGINT handler: close LanceDB, close watcher, exit |
| 23 | Debounce watch events | `index.ts` | chokidar `awaitWriteFinish: true` |
| 9 | Last short declaration dead code | `chunker.ts` | Remove no-op `content = ...` reassignment |

---

## Phase 4 — Performance (4 items)

| # | Fix | Files | Approach |
|---|-----|-------|----------|
| 24 | All chunks in memory | `index.ts` | Stream per-file: chunk → embed → store, no array accumulation |
| 20 | LanceDB connection per request | `handlers.ts` | Open once, pass as param to handlers |
| 19 | No retry on Ollama errors | `embedder.ts` | Retry 3x with backoff on 503 or timeout |
| 14 | Sync I/O in chunkers | `chunker.ts` | `readFileSync` → `readFile` (async) |

---

## Phase 5 — Polish (8 items)

| # | Fix | Files |
|---|-----|-------|
| 18 | Glob fallback broken for complex patterns | `chunker.ts` |
| 21 | No streaming of large search results | `server.ts` |
| 15 | No embedding backend abstraction | `embedder.ts` + interface |
| 12 | No `--version` flag | `cli.ts` + `package.json` |
| 25 | Config field validation | `config.ts` |
| 28 | No ETA in progress bar | `output.ts` |
| 26 | Remove unused `@cfworker/json-schema` dep | `package.json` |
| 27 | Consistent token estimation formula | `chunker.ts`, `embedder.ts` |

---

## File hit map

| File | Phases | Changes |
|------|--------|---------|
| `chunker.ts` | 1, 3, 5 | 7 |
| `handlers.ts` | 1, 4 | 4 |
| `embedder.ts` | 2, 4, 5 | 5 |
| `store.ts` | 2 | 2 |
| `serve.ts` | 2 | 1 |
| `init.ts` | 2 | 1 |
| `config.ts` | 2, 5 | 2 |
| `index.ts` | 2, 3, 4 | 4 |
| `mcp.ts` | 1 | 1 |
| `server.ts` | 3, 5 | 2 |
| `cli.ts` | 5 | 1 |
| `output.ts` | 5 | 1 |
| `ragdir.ts` | 2 | 1 |
| `package.json` | 5 | 1 |
