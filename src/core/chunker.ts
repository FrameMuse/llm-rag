import { readFileSync, readdirSync } from "fs"
import matter from "gray-matter"
import { join, relative } from "path"
import { createHash } from "crypto"

export interface Chunk {
  id: string
  collection: string
  filePath: string
  heading: string
  parentHeading: string | null
  content: string
  tokens: number
}

const HEADING_RE = /^(#{2,4})\s+(.+)$/gm

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function chunkId(filePath: string, heading: string): string {
  return createHash("md5")
    .update(`${filePath}::${heading}`)
    .digest("hex")
    .slice(0, 16)
}

export function chunkFile(
  filePath: string,
  collection: string,
  projectDir: string,
): Chunk[] {
  const raw = readFileSync(filePath, "utf-8")
  const parsed = matter(raw)
  const content = parsed.content
  const relPath = relative(projectDir, filePath)

  const chunks: Chunk[] = []
  let lastH1: string | null = null
  let lastH2: string | null = null

  HEADING_RE.lastIndex = 0
  const headings: { level: number; text: string; index: number }[] = []
  let match: RegExpExecArray | null
  while ((match = HEADING_RE.exec(content)) !== null) {
    const level = match[1].length
    headings.push({ level, text: match[2].trim(), index: match.index })
  }

  if (headings.length === 0) {
    const trimmed = content.trim()
    if (trimmed.length < 200) return []
    chunks.push({
      id: chunkId(relPath, "__body__"),
      collection,
      filePath: relPath,
      heading: "__body__",
      parentHeading: null,
      content: trimmed,
      tokens: estimateTokens(trimmed),
    })
    return chunks
  }

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]
    const start = h.index
    const end = i + 1 < headings.length ? headings[i + 1].index : content.length
    const sectionContent = content.slice(start + h.text.length + h.level + 1, end).trim()

    if (sectionContent.length < 200 && i + 1 < headings.length) continue

    if (h.level === 1) lastH1 = h.text
    if (h.level === 2) lastH2 = h.text

    const parent = h.level > 2 ? (h.level === 3 ? lastH2 : lastH1) : null

    chunks.push({
      id: chunkId(relPath, h.text),
      collection,
      filePath: relPath,
      heading: h.text,
      parentHeading: parent,
      content: sectionContent,
      tokens: estimateTokens(sectionContent),
    })
  }

  return chunks
}

export function walkFiles(projectDir: string, _pattern: string): string[] {
  const files: string[] = []
  function walk(dir: string) {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue
        walk(fullPath)
      } else if (entry.name.endsWith(".md")) {
        files.push(fullPath)
      }
    }
  }
  walk(projectDir)
  return files.sort()
}
