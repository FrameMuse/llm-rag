import { readFileSync } from "fs"
import { resolve } from "path"
import type { RagConfig } from "../core/config"
import { getDataDir } from "../core/config"
import { embed, chat, ensureModel } from "../core/embedder"
import { initStore, tableExists, openTable, hybridSearchTable, listDocumentPaths, dbPath } from "../core/store"
import type { SearchResult } from "../core/store"

const RAG_CHUNKS = 12

// ── diversity reranker ────────────────────────────────

function diversify(results: SearchResult[], limit = RAG_CHUNKS): SearchResult[] {
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

async function expandQuery(question: string, config: RagConfig): Promise<string[]> {
  const prompt = "Generate 2 alternative concise phrasings of this question that cover different aspects. Return each on a new line, no numbering."
  try {
    const expansion = await chat(prompt, `Original: ${question}`, config.ragModel)
    const alternates = expansion.split("\n").map(l => l.trim()).filter(l => l.length > 10)
    return [question, ...alternates.slice(0, 2)]
  } catch {
    return [question]
  }
}

// ── query decomposition ───────────────────────────────

async function decomposeQuestion(question: string, config: RagConfig): Promise<string[]> {
  const prompt = "Break this question into 3 subtopics that each cover a distinct aspect. Return one per line, no numbering."
  try {
    const result = await chat(prompt, `Question: ${question}`, config.ragModel)
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
): Promise<SearchResult[]> {
  await ensureModel(config.embedModel)
  const dataDir = getDataDir(ragDir)
  const conn = await initStore(dbPath(dataDir))
  const exists = await tableExists(conn, config.name)
  if (!exists) return []
  const table = await openTable(conn, config.name)

  const queries = await expandQuery(question, config)
  const subtopics = await decomposeQuestion(question, config)
  const all = [...queries, ...subtopics]

  const allRaw: SearchResult[] = []
  const seen = new Set<string>()

  for (const q of all) {
    const vec = await embed(q, config.embedModel)
    const results = await hybridSearchTable(table, q, vec, 8)
    for (const r of results) {
      if (!seen.has(r.id)) {
        allRaw.push(r)
        seen.add(r.id)
      }
    }
  }

  return diversify(allRaw, RAG_CHUNKS)
}

// ── search ────────────────────────────────────────────

export async function handleSearch(
  ragDir: string,
  _projectDir: string,
  config: RagConfig,
  query: string,
  limit: number,
) {
  await ensureModel(config.embedModel)
  const dataDir = getDataDir(ragDir)
  const conn = await initStore(dbPath(dataDir))
  const exists = await tableExists(conn, config.name)
  if (!exists) {
    return { query, results: [], error: "No index found. Run `rag index` first." }
  }
  const table = await openTable(conn, config.name)
  const vec = await embed(query, config.embedModel)

  const results = await hybridSearchTable(table, query, vec, Math.min(limit, 20))

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

// ── RAG query ─────────────────────────────────────────

export async function handleQuery(
  ragDir: string,
  _projectDir: string,
  config: RagConfig,
  question: string,
) {
  await ensureModel(config.ragModel)

  const results = await retrieveExpanded(ragDir, config, question)

  if (results.length === 0) {
    return { answer: "No index found. Run `rag index` first.", sources: [] }
  }

  const context = results
    .map((r, i) => `[${i + 1}] ${r.filePath} > ${r.heading}\n${r.content}`)
    .join("\n\n---\n\n")

  const system = `You are a knowledgeable assistant with access to documentation for "${config.name}".
Answer based ONLY on the provided context.
If the context lacks information, state what is missing — do not make up details.
Cite sources using [N] references.
Do not invent concepts not present in the context.`

  const answer = await chat(system, `Context:\n${context}\n\nQuestion: ${question}`, config.ragModel)

  return {
    answer,
    sources: results.map((r, i) => ({
      filePath: r.filePath,
      heading: r.heading,
      snippet: r.content.slice(0, 200),
      score: Math.round((1 - i / results.length) * 1000) / 1000,
    })),
  }
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
