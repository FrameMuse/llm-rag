import * as lancedb from "@lancedb/lancedb"
import type { Table } from "@lancedb/lancedb"
import { join } from "path"
import type { Chunk } from "./chunker"

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

export async function searchTable(
  table: Table,
  queryVector: number[],
  limit: number,
): Promise<{ id: string; filePath: string; heading: string; parentHeading: string | null; content: string; tokens: number; _distance: number }[]> {
  const results = await table
    .vectorSearch(queryVector)
    .limit(limit)
    .toArray()

  return results.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    filePath: r.filePath as string,
    heading: r.heading as string,
    parentHeading: r.parentHeading as string | null,
    content: r.content as string,
    tokens: r.tokens as number,
    _distance: r._distance as number,
  }))
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
