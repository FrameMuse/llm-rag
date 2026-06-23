import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, resolve, basename } from "path"

export interface RagConfig {
  name: string
  embedModel: string
  ragModel: string
  pattern: string
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
  embedModel: "nomic-embed-text",
  ragModel: "llama3.2:3b",
  pattern: "*.md",
  indexedAt: null,
  fileCount: 0,
  chunkCount: 0,
}

export function readConfig(ragDir: string): RagConfig {
  const path = join(ragDir, "config.json")
  if (!existsSync(path)) {
    console.error(`Missing ${path}. Run \`rag init\` first.`)
    process.exit(1)
  }
  return JSON.parse(readFileSync(path, "utf-8"))
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

export function ensureRagDir(projectDir: string, name?: string): string {
  const ragDir = join(projectDir, ".rag")
  if (!existsSync(ragDir)) mkdirSync(ragDir, { recursive: true })

  const config: RagConfig = {
    ...DEFAULT_CONFIG,
    name: name || basename(projectDir),
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
