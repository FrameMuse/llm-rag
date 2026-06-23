import * as lancedb from "@lancedb/lancedb"
import { Index } from "@lancedb/lancedb"
import type { Table } from "@lancedb/lancedb"
import { join } from "path"
import type { Chunk } from "./chunker"

export interface SearchResult {
  id: string
  filePath: string
  heading: string
  parentHeading: string | null
  content: string
  tokens: number
  _distance: number
  _score?: number
}

export async function initStore(path: string): Promise<lancedb.Connection> {
  return lancedb.connect(path)
}

export async function tableExists(
  conn: lancedb.Connection,
  name: string,
): Promise<boolean> {
  const names = await conn.tableNames()
  return names.includes(name)
}

export async function openTable(
  conn: lancedb.Connection,
  name: string,
): Promise<Table> {
  return conn.openTable(name)
}

export async function createTableFromRecords(
  conn: lancedb.Connection,
  name: string,
  records: Record<string, unknown>[],
): Promise<Table> {
  return conn.createTable(name, records, { mode: "overwrite" })
}

export function chunkToRecord(chunk: Chunk, vector: number[]): Record<string, unknown> {
  return {
    id: chunk.id,
    collection: chunk.collection,
    filePath: chunk.filePath,
    heading: chunk.heading,
    parentHeading: chunk.parentHeading ?? "",
    content: chunk.content,
    tokens: chunk.tokens,
    vector,
  }
}

export async function addChunks(
  table: Table,
  records: Record<string, unknown>[],
): Promise<void> {
  if (records.length === 0) return
  await table.add(records)
}

export async function createFtsIndex(table: Table): Promise<void> {
  try {
    await table.createIndex("content", { config: Index.fts() })
  } catch (e) {
    console.error("FTS index creation failed (may already exist):", e)
  }
}

function formatResult(r: Record<string, unknown>): SearchResult {
  return {
    id: r.id as string,
    filePath: r.filePath as string,
    heading: r.heading as string,
    parentHeading: r.parentHeading as string | null,
    content: r.content as string,
    tokens: r.tokens as number,
    _distance: r._distance as number,
    _score: r._score as number | undefined,
  }
}

export async function searchTable(
  table: Table,
  queryVector: number[],
  limit: number,
): Promise<SearchResult[]> {
  const results = await table
    .vectorSearch(queryVector)
    .limit(limit)
    .toArray()

  return results.map(formatResult)
}

export async function hybridSearchTable(
  table: Table,
  query: string,
  queryVector: number[],
  limit: number,
): Promise<SearchResult[]> {
  const K = limit * 2

  const [vecRaw, ftsRaw] = await Promise.all([
    table.vectorSearch(queryVector).limit(K).toArray(),
    table.search(query, "fts", ["content"]).limit(K).toArray(),
  ])

  const scores = new Map<string, { result: Record<string, unknown>; rank: number; score: number }>()
  let idx = 0

  for (const r of vecRaw as Record<string, unknown>[]) {
    if (!scores.has(r.id as string)) {
      scores.set(r.id as string, { result: r, rank: idx, score: 0 })
    }
    idx++
  }

  idx = 0
  for (const r of ftsRaw as Record<string, unknown>[]) {
    const existing = scores.get(r.id as string)
    if (existing) {
      existing.score += 1 / (60 + idx)
    } else {
      scores.set(r.id as string, { result: r, rank: idx, score: 1 / (60 + idx) })
    }
    idx++
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => ({ ...formatResult(s.result), _score: s.score }))
}

export async function deleteChunksForFile(
  table: Table,
  filePath: string,
): Promise<void> {
  const escaped = filePath.replace(/'/g, "\\'")
  await table.delete(`filePath = '${escaped}'`)
}

export async function listDocumentPaths(table: Table): Promise<string[]> {
  const results = await table.query().select(["filePath"]).limit(100000).toArray()
  const paths = new Set(results.map((r: Record<string, unknown>) => r.filePath as string))
  return [...paths].sort()
}

export function dbPath(dataDir: string): string {
  return join(dataDir, "lancedb")
}
