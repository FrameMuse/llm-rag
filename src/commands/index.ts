import { walkFiles, chunkFile } from "../core/chunker"
import { requireRagDir } from "../core/ragdir"
import { readConfig, writeConfig, getProjectDir, getDataDir } from "../core/config"
import { ensureModel, embedBatch } from "../core/embedder"
import { initStore, createTableFromRecords, chunkToRecord, dbPath } from "../core/store"
import { ProgressBar } from "../utils/output"

export async function indexCommand(): Promise<void> {
  const ragDir = requireRagDir()
  const config = readConfig(ragDir)
  const projectDir = getProjectDir(ragDir)

  console.log(`Indexing '${config.name}' (pattern: ${config.pattern})...`)
  console.log(`  Project: ${projectDir}`)
  console.log(`  Model:   ${config.embedModel}`)

  await ensureModel(config.embedModel)

  const files = walkFiles(projectDir, config.pattern)
  console.log(`  Files:   ${files.length}`)

  const allChunks: Chunk[] = []
  for (const file of files) {
    const chunks = chunkFile(file, config.name, projectDir)
    allChunks.push(...chunks)
  }

  console.log(`  Chunks:  ${allChunks.length}`)

  if (allChunks.length === 0) {
    console.log("No chunks to index.")
    return
  }

  const texts = allChunks.map((c) => c.content)
  const bar = new ProgressBar("Embedding", texts.length)
  const embeddings = await embedBatch(texts, config.embedModel, (done) => bar.tick(done - bar.position))

  const dataDir = getDataDir(ragDir)
  const conn = await initStore(dbPath(dataDir))

  const records = allChunks
    .map((chunk, i) => (embeddings[i] ? chunkToRecord(chunk, embeddings[i]!) : null))
    .filter(Boolean) as Record<string, unknown>[]

  const failedCount = embeddings.filter((e) => e === null).length
  if (failedCount > 0) {
    console.log(`  Skipped ${failedCount} chunks (embedding failed).`)
  }

  await createTableFromRecords(conn, config.name, records)

  config.indexedAt = new Date().toISOString()
  config.fileCount = files.length
  config.chunkCount = records.length
  writeConfig(ragDir, config)

  console.log("  Done.")
  console.log(`  Indexed ${records.length} chunks from ${files.length} files.`)
}
