import { existsSync } from "fs"
import { join, dirname, resolve } from "path"

export function findRagDir(start?: string): string | null {
  let dir = start ? resolve(start) : process.cwd()
  while (true) {
    if (existsSync(join(dir, ".rag"))) return join(dir, ".rag")
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function requireRagDir(start?: string): string {
  const ragDir = findRagDir(start)
  if (!ragDir) {
    throw new Error("No .rag/ found. Run `rag init` first.")
  }
  return ragDir
}
