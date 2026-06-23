import { readFileSync } from "fs"
import { resolve } from "path"
import type { RagConfig } from "../core/config"
import { getDataDir } from "../core/config"
import { embed, chat, ensureModel } from "../core/embedder"
import { initStore, tableExists, openTable, searchTable, listDocumentPaths, dbPath } from "../core/store"

const RAG_CHUNKS = 16

function diversify(
  results: Awaited<ReturnType<typeof searchTable>>,
): Awaited<ReturnType<typeof searchTable>> {
  const picked: typeof results = []
  const seenFiles = new Set<string>()
  const seenHeadings = new Set<string>()

  for (const r of results) {
    const key = `${r.filePath}::${r.heading}`
    if (seenHeadings.has(key)) continue
    if (picked.length < 4 || !seenFiles.has(r.filePath)) {
      picked.push(r)
      seenFiles.add(r.filePath)
      seenHeadings.add(key)
      if (picked.length >= RAG_CHUNKS) break
    }
  }

  for (const r of results) {
    if (picked.length >= RAG_CHUNKS) break
    const key = `${r.filePath}::${r.heading}`
    if (seenHeadings.has(key)) continue
    picked.push(r)
    seenHeadings.add(key)
  }

  return picked
}

export async function handleSearch(
  ragDir: string,
  projectDir: string,
  config: RagConfig,
  query: string,
  limit: number,
) {
  const dataDir = getDataDir(ragDir)
  const conn = await initStore(dbPath(dataDir))
  const exists = await tableExists(conn, config.name)
  if (!exists) {
    return { query, results: [], error: "No index found. Run `rag index` first." }
  }
  const table = await openTable(conn, config.name)

  const queryVector = await embed(query, config.embedModel)
  const results = await searchTable(table, queryVector, limit)

  return {
    query,
    results: results.map((r, i) => ({
      filePath: r.filePath,
      heading: r.heading,
      snippet: r.content.slice(0, 300),
      score: Math.round((1 - i / limit) * 1000) / 1000,
    })),
  }
}

export async function handleQuery(
  ragDir: string,
  projectDir: string,
  config: RagConfig,
  question: string,
) {
  const dataDir = getDataDir(ragDir)
  const conn = await initStore(dbPath(dataDir))
  const exists = await tableExists(conn, config.name)
  if (!exists) {
    return { answer: "No index found. Run `rag index` first.", sources: [] }
  }
  const table = await openTable(conn, config.name)

  const queryVector = await embed(question, config.embedModel)
  const raw = await searchTable(table, queryVector, RAG_CHUNKS * 2)
  const results = diversify(raw)

  await ensureModel(config.ragModel)

  const context = results
    .map((r, i) => `[${i + 1}] ${r.filePath} > ${r.heading}\n${r.content}`)
    .join("\n\n---\n\n")

  const system = `You are a knowledgeable assistant with access to documentation for "${config.name}".
Answer the user's question based ONLY on the provided context.
If the context doesn't contain enough information, say so.
Cite your sources using the [N] references.`

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
  try {
    return readFileSync(fullPath, "utf-8")
  } catch {
    return `Document not found: ${path}`
  }
}
