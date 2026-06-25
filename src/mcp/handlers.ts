import { readFileSync } from "fs"
import { resolve, relative, join } from "path"
import type { RagConfig } from "../core/config"
import { getDataDir } from "../core/config"
import { embed, chat, ensureModel } from "../core/embedder"
import { initStore, tableExists, openTable, hybridSearchTable, listDocumentPaths, dbPath } from "../core/store"
import type { SearchResult } from "../core/store"
import { KnowledgeGraph } from "../core/graph"

// ── diversity reranker ────────────────────────────────

function diversify(results: SearchResult[], limit: number): SearchResult[] {
  const picked: SearchResult[] = []
  const seenFiles = new Set<string>()
  const seenIds = new Set<string>()

  for (const r of results) {
    if (seenIds.has(r.id)) continue
    if (picked.length < 4 || !seenFiles.has(r.filePath)) {
      picked.push(r)
      seenFiles.add(r.filePath)
      seenIds.add(r.id)
      if (picked.length >= limit) break
    }
  }

  for (const r of results) {
    if (picked.length >= limit) break
    if (seenIds.has(r.id)) continue
    picked.push(r)
    seenIds.add(r.id)
  }

  return picked
}

// ── query expansion ───────────────────────────────────

async function expandQuery(question: string, ragModel: string, temperature: number): Promise<string[]> {
  const prompt = "Generate 2 alternative concise phrasings of this question that cover different aspects. Return each on a new line, no numbering."
  try {
    const expansion = await chat(prompt, `Original: ${question}`, ragModel, temperature)
    const alternates = expansion.split("\n").map(l => l.trim()).filter(l => l.length > 10)
    return [question, ...alternates.slice(0, 2)]
  } catch {
    return [question]
  }
}

// ── query decomposition ───────────────────────────────

async function decomposeQuestion(question: string, ragModel: string, temperature: number): Promise<string[]> {
  const prompt = "Break this question into 3 subtopics that each cover a distinct aspect. Return one per line, no numbering."
  try {
    const result = await chat(prompt, `Question: ${question}`, ragModel, temperature)
    const topics = result.split("\n").map(l => l.trim()).filter(l => l.length > 5)
    return topics.slice(0, 3)
  } catch {
    return []
  }
}

// ── multi-query retrieval ─────────────────────────────

async function retrieveExpanded(
  ragDir: string,
  config: RagConfig,
  question: string,
  chunks: number,
  embedModel?: string,
  ragModel?: string,
): Promise<SearchResult[]> {
  const em = embedModel || config.embedModel
  const rm = ragModel || config.ragModel
  await ensureModel(em)
  const dataDir = getDataDir(ragDir)
  const conn = await initStore(dbPath(dataDir))
  const exists = await tableExists(conn, config.name)
  if (!exists) return []
  const table = await openTable(conn, config.name)

  const queries = await expandQuery(question, rm, config.temperature)
  const subtopics = await decomposeQuestion(question, rm, config.temperature)
  const all = [...queries, ...subtopics]

  const allRaw: SearchResult[] = []
  const seen = new Set<string>()
  const perQuery = Math.ceil(chunks / 2)

  for (const q of all) {
    const vec = await embed(q, em)
    const results = await hybridSearchTable(table, q, vec, perQuery)
    for (const r of results) {
      if (!seen.has(r.id)) {
        allRaw.push(r)
        seen.add(r.id)
      }
    }
  }

  return diversify(allRaw, chunks)
}

// ── search ────────────────────────────────────────────

export async function handleSearch(
  ragDir: string,
  _projectDir: string,
  config: RagConfig,
  query: string,
  opts?: { chunks?: number; embedModel?: string },
) {
  const chunks = opts?.chunks ?? config.chunks
  const embedModel = opts?.embedModel ?? config.embedModel

  await ensureModel(embedModel)
  const dataDir = getDataDir(ragDir)
  const conn = await initStore(dbPath(dataDir))
  const exists = await tableExists(conn, config.name)
  if (!exists) {
    return { query, results: [], error: "No index found. Run `rag index` first." }
  }
  const table = await openTable(conn, config.name)
  const vec = await embed(query, embedModel)

  const results = await hybridSearchTable(table, query, vec, Math.min(chunks, 20))

  return {
    query,
    results: results.map((r, i) => ({
      filePath: r.filePath,
      heading: r.heading,
      snippet: r.content.slice(0, 300),
      score: Math.round((1 - i / results.length) * 1000) / 1000,
    })),
  }
}

// ── graph context builder ──────────────────────────

async function buildGraphContext(
  ragDir: string,
  config: RagConfig,
  question: string,
  ragModel: string,
): Promise<string | null> {
  let g: KnowledgeGraph
  try {
    const dataDir = getDataDir(ragDir)
    g = new KnowledgeGraph()
    g.load(join(dataDir, "graph.json"))
    if (g.nodes.size === 0) return null
  } catch {
    return null
  }

  const planPrompt = `You have a knowledge graph with these query commands:
- find(text) — search nodes by name
- neighbors(id) — connections for a node
- path(from, to) — shortest path between two nodes
- god-refs(limit) — most connected core abstractions
Name the top entity the question is about, then specify up to 2 graph queries to run.

Return JSON: { "entity": "CanvasDraw", "queries": [{"query": "neighbors", "args": ["CanvasDraw"]}] }`

  let planText: string
  try {
    const planResult = await chat("You are a concise graph query planner.", planPrompt + `\n\nQuestion: ${question}`, ragModel, config.temperature)
    planText = planResult.trim()
    // Extract JSON from potential markdown code block
    const jsonMatch = planText.match(/```(?:json)?\s*([\s\S]*?)```/) || planText.match(/{[\s\S]*}/)
    planText = jsonMatch?.[1] ?? planText
  } catch {
    return null
  }

  let plan: { entity?: string; queries?: { query: string; args: string[] }[] }
  try {
    plan = JSON.parse(planText)
  } catch {
    return null
  }

  if (!plan.queries || plan.queries.length === 0) return null

  const blocks: string[] = []

  for (const q of plan.queries) {
    const queryType = q.query?.toLowerCase()
    const args = q.args || []

    if (queryType === "find" && args[0]) {
      const results = g.find(args[0])
      if (results.length > 0) {
        const top = results.slice(0, 5).map(r => `  ${r.name} — ${r.type} — ${r.file}`).join("\n")
        blocks.push(`find "${args[0]}":\n${top}`)
      }
    } else if (queryType === "neighbors" && args[0]) {
      const fullId = args.length > 1 ? args[1] : (g.find(args[0])[0]?.id)
      if (fullId) {
        const nbs = g.neighbors(fullId, "both")
        if (nbs.length > 0) {
          const lines = nbs.slice(0, 10).map(n => `  ${n.edge.type} → ${n.neighbor.name}`)
          blocks.push(`neighbors of "${args[0]}":\n${lines.join("\n")}`)
        }
      }
    } else if (queryType === "path" && args[0] && args[1]) {
      const fromId = g.find(args[0])[0]?.id
      const toId = g.find(args[1])[0]?.id
      if (fromId && toId) {
        const edges = g.path(fromId, toId)
        if (edges.length > 0) {
          const path = edges.map(e => `  ${e.type} → ${e.target === edges[edges.length - 1].target ? args[1] : e.target}`).join("\n")
          blocks.push(`path from "${args[0]}" to "${args[1]}":\n${path}`)
        }
      }
    } else if (queryType === "god-refs") {
      const limit = args[0] ? parseInt(args[0], 10) || 5 : 5
      const hubs = g.godNodes(limit)
      blocks.push(`god references (top ${limit}):\n${hubs.map(h => `  ${h.node?.name ?? h.id} — ${h.degree} connections`).join("\n")}`)
    }
  }

  if (blocks.length === 0) return null

  return "=== Graph Context ===\n" + blocks.join("\n\n") + "\n"
}

// ── RAG query ─────────────────────────────────────────

export async function handleQuery(
  ragDir: string,
  _projectDir: string,
  config: RagConfig,
  question: string,
  opts?: { chunks?: number; embedModel?: string; ragModel?: string; temperature?: number; graph?: boolean },
) {
  const chunks = opts?.chunks ?? config.chunks
  const ragModel = opts?.ragModel ?? config.ragModel
  const embedModel = opts?.embedModel ?? config.embedModel

  const effectiveConfig = { ...config }
  if (opts?.temperature !== undefined) effectiveConfig.temperature = opts.temperature

  await ensureModel(ragModel)

  const results = await retrieveExpanded(ragDir, effectiveConfig, question, chunks, embedModel, ragModel)

  let graphContext = ""
  if (opts?.graph) {
    const gc = await buildGraphContext(ragDir, effectiveConfig, question, ragModel)
    if (gc) graphContext = gc
  }

  if (results.length === 0 && !graphContext) {
    return { answer: "No index found. Run `rag index` first.", sources: [] }
  }

  const docContext = results
    .map((r, i) => `[${i + 1}] ${r.filePath} > ${r.heading}\n${r.content}`)
    .join("\n\n---\n\n")

  const context = docContext ? `${graphContext}=== Document Context ===\n${docContext}` : graphContext

  const system = `You are a knowledgeable assistant with access to documentation for "${config.name}".
Answer based on both the graph context and document context provided.
Use the graph context for structural/relationship questions, and document context for detailed explanations.
Cite sources using [N] references.
If the context lacks information, state what is missing — do not make up details.`

  const answer = await chat(system, `Context:\n${context}\n\nQuestion: ${question}`, ragModel, effectiveConfig.temperature)

  const sources: { filePath: string; heading: string; snippet: string; score: number }[] = []
  if (opts?.graph) {
    sources.push({ filePath: "graph", heading: "knowledge graph", snippet: "structural context", score: 1.00 })
  }
  for (let i = 0; i < results.length; i++) {
    sources.push({
      filePath: results[i].filePath,
      heading: results[i].heading,
      snippet: results[i].content.slice(0, 200),
      score: Math.round((1 - i / results.length) * 1000) / 1000,
    })
  }

  return { answer, sources }
}

// ── document listing ──────────────────────────────────

export async function handleListDocuments(
  ragDir: string,
  config: RagConfig,
) {
  const dataDir = getDataDir(ragDir)
  const conn = await initStore(dbPath(dataDir))
  const exists = await tableExists(conn, config.name)
  if (!exists) return []
  const table = await openTable(conn, config.name)
  return await listDocumentPaths(table)
}

export async function handleGetDocument(
  ragDir: string,
  projectDir: string,
  path: string,
): Promise<string> {
  const fullPath = resolve(projectDir, path)
  if (relative(projectDir, fullPath).startsWith("..")) {
    return `Access denied: ${path}`
  }
  try {
    return readFileSync(fullPath, "utf-8")
  } catch {
    return `Document not found: ${path}`
  }
}
