import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, resolve, basename } from "path"

export interface RagConfig {
  name: string
  embedModel: string
  ragModel: string
  visionModel: string
  pattern: string
  chunks: number
  temperature: number
  indexedAt: string | null
  fileCount: number
  chunkCount: number
}

export interface McpJsonEntry {
  type: "local"
  command: string[]
  cwd: string
  enabled: boolean
}

export const DEFAULT_CONFIG: RagConfig = {
  name: "",
  embedModel: "mxbai-embed-large",
  ragModel: "llama3.2:3b",
  visionModel: "qwen3-vl",
  pattern: "",
  chunks: 8,
  temperature: 0.3,
  indexedAt: null,
  fileCount: 0,
  chunkCount: 0,
}

export function readConfig(ragDir: string): RagConfig {
  const path = join(ragDir, "config.json")
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}. Run \`rag init\` first.`)
  }
  const raw = JSON.parse(readFileSync(path, "utf-8"))
  return { ...DEFAULT_CONFIG, ...raw }
}

export function writeConfig(ragDir: string, config: RagConfig): void {
  writeFileSync(join(ragDir, "config.json"), JSON.stringify(config, null, 2) + "\n")
}

export function readMcpJson(ragDir: string): Record<string, McpJsonEntry> | null {
  const path = join(ragDir, "mcp.json")
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, "utf-8"))
}

export function writeMcpJson(ragDir: string, entry: Record<string, McpJsonEntry>): void {
  writeFileSync(join(ragDir, "mcp.json"), JSON.stringify(entry, null, 2) + "\n")
}

export function ensureRagDir(projectDir: string, name?: string, pattern?: string): string {
  const ragDir = join(projectDir, ".rag")
  if (!existsSync(ragDir)) mkdirSync(ragDir, { recursive: true })

  const config: RagConfig = {
    ...DEFAULT_CONFIG,
    name: name || basename(projectDir),
    pattern: pattern ?? DEFAULT_CONFIG.pattern,
  }
  writeConfig(ragDir, config)
  writeFileSync(join(ragDir, ".gitignore"), "*\n")

  return ragDir
}

export function getProjectDir(ragDir: string): string {
  return resolve(ragDir, "..")
}

export function getDataDir(ragDir: string): string {
  const dataDir = join(ragDir, "data")
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  return dataDir
}
