import { requireRagDir } from "../core/ragdir"
import { readConfig, getDataDir } from "../core/config"
import { initStore, tableExists, openTable, listDocumentPaths, dbPath } from "../core/store"

export async function infoCommand(): Promise<void> {
  const ragDir = requireRagDir()
  const config = readConfig(ragDir)

  console.log(`Collection: ${config.name}`)
  console.log(`  Embed model: ${config.embedModel}`)
  console.log(`  RAG model:   ${config.ragModel}`)
  console.log(`  File pattern: ${config.pattern}`)
  console.log(`  Files indexed: ${config.fileCount}`)
  console.log(`  Chunks indexed: ${config.chunkCount}`)
  console.log(`  Last indexed: ${config.indexedAt ?? "never"}`)

  if (!config.indexedAt) return

  try {
    const dataDir = getDataDir(ragDir)
    const conn = await initStore(dbPath(dataDir))
    const exists = await tableExists(conn, config.name)
    if (!exists) {
      console.log("  DB table not found. Run `rag index`.")
      return
    }
    const table = await openTable(conn, config.name)
    const docs = await listDocumentPaths(table)
    console.log(`  Actual files: ${docs.length}`)
    for (const doc of docs) {
      console.log(`    ${doc}`)
    }
  } catch (e) {
    console.error(`  DB error: ${e}`)
  }
}
