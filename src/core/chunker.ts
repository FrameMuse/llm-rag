import { readFileSync, readdirSync } from "fs"
import matter from "gray-matter"
import { join, relative, extname } from "path"
import { createHash } from "crypto"
import ts from "typescript"

export interface Chunk {
  id: string
  collection: string
  filePath: string
  heading: string
  parentHeading: string | null
  content: string
  tokens: number
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/gm

export const SUPPORTED_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".md", ".mdx",
  ".css", ".scss", ".less", ".sass",
  ".yaml", ".yml", ".toml", ".html", ".htm",
])

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg",
  "build", "dist", "out", "target",
  "benchmarks", "benchmark", "benchs",
  "coverage", ".nyc_output",
  ".next", ".nuxt", ".cache",
])

// ── helpers ──────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function chunkId(filePath: string, heading: string): string {
  return createHash("md5")
    .update(`${filePath}::${heading}`)
    .digest("hex")
    .slice(0, 16)
}

function buildHeader(filePath: string, heading: string, parent: string | null): string {
  const parts = [filePath, parent, heading].filter(Boolean)
  return `[${parts.join(" > ")}]\n`
}

// ── file walking ──────────────────────────────────────

export function walkFiles(projectDir: string, pattern: string): string[] {
  if (pattern && pattern !== "*") {
    try {
      const Glob = (Bun as any).Glob
      if (Glob) {
        return [...new Glob(`**/${pattern}`).scanSync({ cwd: projectDir })]
          .map((f: string) => join(projectDir, f)).sort()
      }
    } catch {
      // fall through
    }
  }

  const files: string[] = []
  function walk(dir: string) {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) }
    catch { return }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || IGNORE_DIRS.has(entry.name)) continue
        walk(fullPath)
      } else {
        const ext = extname(entry.name).toLowerCase()
        if (!pattern || pattern === "*") {
          if (SUPPORTED_EXTENSIONS.has(ext)) files.push(fullPath)
        } else {
          if (entry.name.endsWith(extname(pattern))) files.push(fullPath)
        }
      }
    }
  }
  walk(projectDir)
  return files.sort()
}

// ── dispatcher ────────────────────────────────────────

export function chunkFile(filePath: string, collection: string, projectDir: string): Chunk[] {
  const ext = extname(filePath).toLowerCase()
  switch (ext) {
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return chunkTsFile(filePath, collection, projectDir)
    case ".json":
      return chunkJsonFile(filePath, collection, projectDir)
    case ".md":
    case ".mdx":
      return chunkMdFile(filePath, collection, projectDir)
    default:
      return chunkTextFile(filePath, collection, projectDir)
  }
}

// ── markdown chunker ──────────────────────────────────

export function chunkMdFile(filePath: string, collection: string, projectDir: string): Chunk[] {
  const raw = readFileSync(filePath, "utf-8")
  const parsed = matter(raw)
  const content = parsed.content
  const relPath = relative(projectDir, filePath)

  const headings: { level: number; text: string; index: number }[] = []
  let match: RegExpExecArray | null
  HEADING_RE.lastIndex = 0
  while ((match = HEADING_RE.exec(content)) !== null) {
    headings.push({ level: match[1].length, text: match[2].trim(), index: match.index })
  }

  if (headings.length === 0) {
    const trimmed = content.trim()
    if (trimmed.length < 200) return []
    return [{
      id: chunkId(relPath, "__body__"),
      collection, filePath: relPath,
      heading: "__body__", parentHeading: null,
      content: buildHeader(relPath, "__body__", null) + trimmed,
      tokens: estimateTokens(trimmed),
    }]
  }

  const chunks: Chunk[] = []
  let lastH1: string | null = null
  let lastH2: string | null = null

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]
    const start = h.index
    const end = i + 1 < headings.length ? headings[i + 1].index : content.length
    const sectionContent = content.slice(start + h.text.length + h.level + 1, end).trim()

    if (h.level === 1) lastH1 = h.text
    if (h.level === 2) lastH2 = h.text

    if (sectionContent.length < 200 && i + 1 < headings.length) continue

    const parent = h.level > 2 ? (h.level === 3 ? lastH2 : lastH1) : null

    chunks.push({
      id: chunkId(relPath, h.text),
      collection, filePath: relPath,
      heading: h.text, parentHeading: parent,
      content: buildHeader(relPath, h.text, parent) + sectionContent,
      tokens: estimateTokens(sectionContent),
    })
  }

  return chunks
}

// ── TypeScript/JS AST chunker ─────────────────────────

export function chunkTsFile(filePath: string, collection: string, projectDir: string): Chunk[] {
  const relPath = relative(projectDir, filePath)
  const sourceText = readFileSync(filePath, "utf-8")
  if (sourceText.trim().length < 50) return []

  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true)

  const chunks: Chunk[] = []
  const decls: { heading: string; start: number; end: number }[] = []
  let importsText = ""
  let pendingImport: string[] = []

  function flushImports() {
    if (pendingImport.length === 0) return
    const text = pendingImport.join("\n")
    if (text.length > 100) {
      chunks.push({
        id: chunkId(relPath, "__imports__"),
        collection, filePath: relPath,
        heading: "__imports__", parentHeading: null,
        content: buildHeader(relPath, "__imports__", null) + text,
        tokens: estimateTokens(text),
      })
    }
    pendingImport = []
  }

  function visit(node: ts.Node) {
    if (node.kind === ts.SyntaxKind.EndOfFileToken) return

    const isImport =
      ts.isImportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      (ts.isExportDeclaration(node) && node.moduleSpecifier)

    if (isImport) {
      pendingImport.push(node.getText(sourceFile))
      return
    }

    flushImports()

    const name = declName(node, sourceFile)
    const start = node.getStart(sourceFile)
    const end = node.end

    if (name) {
      decls.push({ heading: name, start, end })
    } else if (ts.isVariableStatement(node)) {
      const first = node.declarationList.declarations[0]
      const varName = first?.name && ts.isIdentifier(first.name) ? first.name.text : "variable"
      decls.push({ heading: varName, start, end })
    } else if (ts.isExportAssignment(node)) {
      decls.push({ heading: "export default", start, end })
    }
  }

  ts.forEachChild(sourceFile, visit)
  flushImports()

  for (let i = 0; i < decls.length; i++) {
    const d = decls[i]
    let content = sourceText.slice(d.start, d.end).trim()

    if (content.length < 50) {
      if (i + 1 < decls.length) continue
      content = sourceText.slice(d.start, d.end).trim()
    }

    chunks.push({
      id: chunkId(relPath, d.heading),
      collection, filePath: relPath,
      heading: d.heading, parentHeading: null,
      content: buildHeader(relPath, d.heading, null) + content,
      tokens: estimateTokens(content),
    })
  }

  return chunks.length > 0 ? chunks : chunkTextFile(filePath, collection, projectDir)
}

function declName(node: ts.Node, _sourceFile: ts.SourceFile): string | null {
  if (ts.isFunctionDeclaration(node)) return `function ${node.name?.text ?? "(anonymous)"}`
  if (ts.isClassDeclaration(node)) return `class ${node.name?.text ?? "(anonymous)"}`
  if (ts.isInterfaceDeclaration(node) && node.name) return `interface ${node.name.text}`
  if (ts.isTypeAliasDeclaration(node) && node.name) return `type ${node.name.text}`
  if (ts.isEnumDeclaration(node) && node.name) return `enum ${node.name.text}`
  if (ts.isModuleDeclaration(node) && node.name) return `module ${node.name.text}`
  if (ts.isExportAssignment(node)) return "export default"
  if (ts.isExportDeclaration(node) && !node.moduleSpecifier && node.exportClause) return "export"
  return null
}

// ── JSON chunker ──────────────────────────────────────

export function chunkJsonFile(filePath: string, collection: string, projectDir: string): Chunk[] {
  const relPath = relative(projectDir, filePath)
  const sourceText = readFileSync(filePath, "utf-8").trim()
  if (sourceText.length < 50) return []

  try {
    const parsed = JSON.parse(sourceText)
    if (typeof parsed !== "object" || parsed === null) {
      return [{
        id: chunkId(relPath, "__body__"),
        collection, filePath: relPath,
        heading: "__body__", parentHeading: null,
        content: buildHeader(relPath, "__body__", null) + sourceText,
        tokens: estimateTokens(sourceText),
      }]
    }

    const keys = Object.keys(parsed)
    if (keys.length <= 5 || Array.isArray(parsed)) {
      return [{
        id: chunkId(relPath, "__body__"),
        collection, filePath: relPath,
        heading: "__body__", parentHeading: null,
        content: buildHeader(relPath, "__body__", null) + sourceText,
        tokens: estimateTokens(sourceText),
      }]
    }

    return keys.map((key) => {
      const json = JSON.stringify(parsed[key], null, 2)
      return {
        id: chunkId(relPath, key),
        collection, filePath: relPath,
        heading: key, parentHeading: null,
        content: buildHeader(relPath, key, null) + json,
        tokens: estimateTokens(json),
      }
    })
  } catch {
    return chunkTextFile(filePath, collection, projectDir)
  }
}

// ── text fallback chunker (50-line) ───────────────────

export function chunkTextFile(filePath: string, collection: string, projectDir: string): Chunk[] {
  const relPath = relative(projectDir, filePath)
  const lines = readFileSync(filePath, "utf-8").split("\n")
  if (lines.length < 5) return []

  const CHUNK_LINES = 50
  const chunks: Chunk[] = []

  for (let i = 0; i < lines.length; i += CHUNK_LINES) {
    const end = Math.min(i + CHUNK_LINES, lines.length)
    const content = lines.slice(i, end).join("\n").trim()
    if (content.length < 50) continue

    chunks.push({
      id: chunkId(relPath, `L${i + 1}-L${end}`),
      collection, filePath: relPath,
      heading: `L${i + 1}-L${end}`,
      parentHeading: null,
      content: buildHeader(relPath, `L${i + 1}-L${end}`, null) + content,
      tokens: estimateTokens(content),
    })
  }

  return chunks
}
