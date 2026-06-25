import { walkFiles, chunkFile } from "../core/chunker"
import { isImage, describeImage } from "../core/vision"
import { requireRagDir } from "../core/ragdir"
import { readConfig, writeConfig, getProjectDir, getDataDir } from "../core/config"
import { ensureModel, embed, embedBatch } from "../core/embedder"
import { initStore, createTableFromRecords, addChunks, deleteChunksForFile, createFtsIndex, chunkToRecord, openTable, dbPath } from "../core/store"
import { buildGraph } from "./graph"
import { ProgressBar } from "../utils/output"
import { relative, basename, extname } from "path"
import { createHash } from "crypto"

function chunkId(filePath: string, heading: string): string {
  return createHash("md5").update(`${filePath}::${heading}`).digest("hex").slice(0, 16)
}

export async function indexCommand(): Promise<void> {
  const ragDir = requireRagDir()
  const config = readConfig(ragDir)
  const projectDir = getProjectDir(ragDir)

  console.log(`Indexing '${config.name}' (pattern: ${config.pattern || "*"})...`)
  console.log(`  Project: ${projectDir}`)
  console.log(`  Embed:   ${config.embedModel}`)
  if (config.visionModel) console.log(`  Vision:  ${config.visionModel}`)

  await ensureModel(config.embedModel)

  const files = walkFiles(projectDir, config.pattern)
  const textFiles = files.filter((f: string) => !isImage(f))
  const imageFiles = files.filter((f: string) => isImage(f))
  console.log(`  Files:   ${files.length} (${textFiles.length} text, ${imageFiles.length} images)`)

  const dataDir = getDataDir(ragDir)
  const conn = await initStore(dbPath(dataDir))

  let totalChunks = 0
  let totalFiles = 0
  let tableCreated = false

  // ── Phase 1: text files ────────────────────────

  if (textFiles.length > 0) {
    const bar = new ProgressBar("Processing text", textFiles.length)

    for (const file of textFiles) {
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
  }

  // ── Phase 2: image files ───────────────────────

  if (imageFiles.length > 0) {
    await ensureModel(config.visionModel)
    const bar = new ProgressBar("Captions", imageFiles.length)
    const concurrency = 4

    for (let i = 0; i < imageFiles.length; i += concurrency) {
      const batch = imageFiles.slice(i, i + concurrency)

      const results = await Promise.allSettled(
        batch.map((f: string) => processImage(f, config, projectDir)),
      )

      const records: Record<string, unknown>[] = []
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) records.push(r.value)
      }

      if (records.length > 0) {
        if (!tableCreated) {
          await createTableFromRecords(conn, config.name, records)
          tableCreated = true
        } else {
          const tbl = await openTable(conn, config.name)
          await addChunks(tbl, records)
        }
      }

      totalChunks += records.length
      totalFiles += records.length
      bar.tick(batch.length)
    }
  }

  // ── finalize ───────────────────────────────────

  if (tableCreated) {
    const tbl = await openTable(conn, config.name)
    await createFtsIndex(tbl)
  }

  console.log("  Building knowledge graph...")
  buildGraph(ragDir, config, projectDir)

  config.indexedAt = new Date().toISOString()
  config.fileCount = totalFiles
  config.chunkCount = totalChunks
  writeConfig(ragDir, config)

  console.log("  Done.")
  console.log(`  Indexed ${totalChunks} chunks from ${files.length} files.`)
}

async function processImage(
  filePath: string,
  config: import("../core/config").RagConfig,
  projectDir: string,
): Promise<Record<string, unknown> | null> {
  const relPath = relative(projectDir, filePath)
  const caption = await describeImage(filePath, config.visionModel, projectDir)
  if (!caption) return null

  const stem = basename(relPath, extname(relPath)).replace(/[_-]/g, " ")
  const heading = stem.charAt(0).toUpperCase() + stem.slice(1)
  const id = chunkId(relPath, heading)
  const content = `[${relPath} > ${heading}]\n${caption}`
  const tokens = Math.ceil(caption.length / 3)

  const vec = await embed(content, config.embedModel)
  return {
    id,
    collection: config.name,
    filePath: relPath,
    heading,
    parentHeading: "",
    content,
    tokens,
    vector: vec,
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
    await deleteChunksForFile(table, relPath)

    let records: Record<string, unknown>[] = []

    if (isImage(filePath)) {
      const r = await processImage(filePath, config, projectDir)
      if (r) records = [r]
    } else {
      const chunks = await chunkFile(filePath, config.name, projectDir)
      if (chunks.length === 0) return
      const texts = chunks.map((c) => c.content)
      const embeddings = await embedBatch(texts, config.embedModel)
      records = chunks
        .map((chunk, i) => (embeddings[i] ? chunkToRecord(chunk, embeddings[i]!) : null))
        .filter(Boolean) as Record<string, unknown>[]
    }

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
