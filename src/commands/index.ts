import { walkFiles, chunkFile } from "../core/chunker"
import { requireRagDir } from "../core/ragdir"
import { readConfig, writeConfig, getProjectDir, getDataDir } from "../core/config"
import { ensureModel, embed, embedBatch } from "../core/embedder"
import { initStore, createTableFromRecords, addChunks, deleteChunksForFile, createFtsIndex, chunkToRecord, openTable, dbPath } from "../core/store"
import { getIgnoredFiles } from "../utils/watch"
import { ProgressBar } from "../utils/output"
import { relative } from "path"

export async function indexCommand(watchMode = false): Promise<void> {
  const ragDir = requireRagDir()
  const config = readConfig(ragDir)
  const projectDir = getProjectDir(ragDir)

  console.log(`Indexing '${config.name}' (pattern: ${config.pattern || "*"})...`)
  console.log(`  Project: ${projectDir}`)
  console.log(`  Model:   ${config.embedModel}`)

  await ensureModel(config.embedModel)

  const files = walkFiles(projectDir, config.pattern)
  console.log(`  Files:   ${files.length}`)

  const dataDir = getDataDir(ragDir)
  const conn = await initStore(dbPath(dataDir))

  let totalChunks = 0
  let totalFiles = 0
  let tableCreated = false
  const bar = new ProgressBar("Processing", files.length)

  for (const file of files) {
    const chunks = await chunkFile(file, config.name, projectDir)
    if (chunks.length === 0) continue

    const texts = chunks.map((c) => c.content)
    const embeddings = await embedBatch(texts, config.embedModel)
    const records = chunks
      .map((chunk, i) => (embeddings[i] ? chunkToRecord(chunk, embeddings[i]!) : null))
      .filter(Boolean) as Record<string, unknown>[]

    if (records.length === 0) continue

    if (!tableCreated) {
      await createTableFromRecords(conn, config.name, records)
      tableCreated = true
    } else {
      const tbl = await openTable(conn, config.name)
      await addChunks(tbl, records)
    }

    totalChunks += records.length
    totalFiles++
    bar.tick(1)
  }

  if (tableCreated) {
    const tbl = await openTable(conn, config.name)
    await createFtsIndex(tbl)
  }

  config.indexedAt = new Date().toISOString()
  config.fileCount = totalFiles
  config.chunkCount = totalChunks
  writeConfig(ragDir, config)

  console.log("  Done.")
  console.log(`  Indexed ${totalChunks} chunks from ${totalFiles} files.`)

  if (watchMode) {
    const { watch } = await import("chokidar")
    const table = await openTable(conn, config.name)
    const isIgnored = getIgnoredFiles(projectDir)
    const watcher = watch(projectDir, {
      ignored: (path: string) => isIgnored(path),
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    })
    watcher.on("change", (p) => reindexFile(ragDir, config, projectDir, p, conn, table))
    watcher.on("add", (p) => reindexFile(ragDir, config, projectDir, p, conn, table))
    watcher.on("unlink", (p) => removeFile(ragDir, config, projectDir, p, conn, table))
    process.on("SIGINT", () => {
      watcher.close()
      conn.close()
      process.exit(0)
    })
    console.log("Watching for changes...")
    await new Promise(() => {})
  }
}

export async function reindexFile(
  ragDir: string,
  config: import("../core/config").RagConfig,
  projectDir: string,
  filePath: string,
  conn: import("@lancedb/lancedb").Connection,
  table: import("@lancedb/lancedb").Table,
): Promise<void> {
  const relPath = relative(projectDir, filePath)
  try {
    const chunks = await chunkFile(filePath, config.name, projectDir)
    if (chunks.length === 0) return

    await deleteChunksForFile(table, relPath)

    const texts = chunks.map((c) => c.content)
    const embeddings = await embedBatch(texts, config.embedModel)

    const records = chunks
      .map((chunk, i) => (embeddings[i] ? chunkToRecord(chunk, embeddings[i]!) : null))
      .filter(Boolean) as Record<string, unknown>[]

    if (records.length > 0) {
      await addChunks(table, records)
    }

    console.error(`  Re-indexed ${relPath} (${records.length} chunks)`)
  } catch (e) {
    console.error(`  Failed to re-index ${relPath}: ${e}`)
  }
}

export async function removeFile(
  ragDir: string,
  config: import("../core/config").RagConfig,
  projectDir: string,
  filePath: string,
  conn: import("@lancedb/lancedb").Connection,
  table: import("@lancedb/lancedb").Table,
): Promise<void> {
  const relPath = relative(projectDir, filePath)
  await deleteChunksForFile(table, relPath)
  console.error(`  Removed ${relPath}`)
}
