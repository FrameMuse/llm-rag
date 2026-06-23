import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { chunkMdFile, chunkTsFile, chunkJsonFile, chunkTextFile, chunkFile, walkFiles } from "../src/core/chunker"
import { readConfig, writeConfig, DEFAULT_CONFIG } from "../src/core/config"

const fixtures = join(import.meta.dir, "fixtures")

interface Chunk {
  id: string
  collection: string
  filePath: string
  heading: string
  parentHeading: string | null
  content: string
  tokens: number
}

// ── markdown chunker tests ────────────────────────────

describe("chunkMdFile", () => {
  it("splits by h2 headings", async () => {
    const chunks = await chunkMdFile(join(fixtures, "sample.md"), "test", fixtures)
    expect(chunks.length).toBeGreaterThanOrEqual(3)

    const headings = chunks.map((c: Chunk) => c.heading)
    expect(headings).toContain("Getting Started")
    expect(headings).toContain("createComponent")
    expect(headings).toContain("Examples")
  })

  it("preserves heading hierarchy", async () => {
    const chunks = await chunkMdFile(join(fixtures, "sample.md"), "test", fixtures)
    const ns = chunks.find((c: Chunk) => c.heading === "createComponent")
    expect(ns).toBeDefined()
    expect(ns!.parentHeading).toBe("API Reference")
  })

  it("prepends header to content", async () => {
    const chunks = await chunkMdFile(join(fixtures, "sample.md"), "test", fixtures)
    for (const c of chunks) {
      expect(c.content).toMatch(/^\[/)
    }
  })

  it("skips files with no headings and <200 chars", async () => {
    const tiny = join(fixtures, "tiny.md")
    writeFileSync(tiny, "hi")
    const chunks = await chunkMdFile(tiny, "test", fixtures)
    expect(chunks.length).toBe(0)
    unlinkSync(tiny)
  })
})

// ── TypeScript AST chunker tests ──────────────────────

describe("chunkTsFile", () => {
  it("splits by function declarations", async () => {
    const file = join(fixtures, "test-func.ts")
    writeFileSync(file, "/** doc */\nfunction foo() { return 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 }\n/** doc */\nfunction bar() { return 10 + 9 + 8 + 7 + 6 + 5 + 4 + 3 + 2 + 1 }\n")
    const chunks = await chunkTsFile(file, "test", fixtures)
    const headings = chunks.map((c: Chunk) => c.heading)
    expect(headings).toContain("function foo")
    expect(headings).toContain("function bar")
    unlinkSync(file)
  })

  it("splits by class declarations", async () => {
    const file = join(fixtures, "test-class.ts")
    writeFileSync(file, "/** doc */\nclass Foo { method() { return 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 } }\n/** doc */\nclass Bar { method() { return 10 + 9 + 8 + 7 + 6 + 5 + 4 + 3 + 2 + 1 } }\n")
    const chunks = await chunkTsFile(file, "test", fixtures)
    const headings = chunks.map((c: Chunk) => c.heading)
    expect(headings).toContain("class Foo")
    expect(headings).toContain("class Bar")
    unlinkSync(file)
  })

  it("splits by interface declarations", async () => {
    const file = join(fixtures, "test-iface.ts")
    writeFileSync(file, "/** doc */\ninterface Foo { x: number; y: string; z: boolean; a: number; b: string; c: boolean }\n/** doc */\ninterface Bar { a: number; b: string; c: boolean; d: number; e: string; f: boolean }\n")
    const chunks = await chunkTsFile(file, "test", fixtures)
    const headings = chunks.map((c: Chunk) => c.heading)
    expect(headings).toContain("interface Foo")
    expect(headings).toContain("interface Bar")
    unlinkSync(file)
  })

  it("splits by type alias", async () => {
    const file = join(fixtures, "test-type.ts")
    writeFileSync(file, "type Foo = { x: number; y: string; z: boolean; a: number; b: string; c: boolean }\n")
    const chunks = await chunkTsFile(file, "test", fixtures)
    const headings = chunks.map((c: Chunk) => c.heading)
    expect(headings).toContain("type Foo")
    unlinkSync(file)
  })

  it("handles unnamed default export function", async () => {
    const file = join(fixtures, "test-default.ts")
    writeFileSync(file, "export default function() { return 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11 + 12 + 13 + 14 + 15 }\n")
    const chunks = await chunkTsFile(file, "test", fixtures)
    const headings = chunks.map((c: Chunk) => c.heading)
    expect(headings).toContain("function (anonymous)")
    unlinkSync(file)
  })

  it("collects imports into a single chunk", async () => {
    const file = join(fixtures, "test-imports.ts")
    writeFileSync(file, 'import { a as alpha } from "./a-long-module-name"\nimport { b as beta } from "./b-long-module-name"\nimport { c } from "./c-long-module-name"\n\nexport function foo() { return a + b + c + alpha + beta }\n')
    const chunks = await chunkTsFile(file, "test", fixtures)
    const imports = chunks.find((c: Chunk) => c.heading === "__imports__")
    expect(imports).toBeDefined()
    expect(imports!.content).toContain("import")
    unlinkSync(file)
  })
})

// ── JSON chunker tests ────────────────────────────────

describe("chunkJsonFile", () => {
  it("returns single chunk for small objects", async () => {
    const file = join(fixtures, "small.json")
    writeFileSync(file, JSON.stringify({ name: "test", version: "1.0", description: "a longer value to exceed the minimum char threshold for chunking" }))
    const chunks = await chunkJsonFile(file, "test", fixtures)
    expect(chunks.length).toBe(1)
    expect(chunks[0].heading).toBe("__body__")
    unlinkSync(file)
  })

  it("splits large objects by key", async () => {
    const file = join(fixtures, "large.json")
    writeFileSync(file, JSON.stringify({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 0 }))
    const chunks = await chunkJsonFile(file, "test", fixtures)
    expect(chunks.length).toBe(10)
    expect(chunks[0].heading).toBe("a")
    unlinkSync(file)
  })

  it("prepends header to content", async () => {
    const file = join(fixtures, "json-header.json")
    writeFileSync(file, JSON.stringify({ key: "value with enough text to exceed the fifty character minimum threshold for processing" }))
    const chunks = await chunkJsonFile(file, "test", fixtures)
    expect(chunks[0].content).toMatch(/^\[/)
    unlinkSync(file)
  })
})

// ── text fallback chunker tests ───────────────────────

describe("chunkTextFile", () => {
  it("splits by 50 lines", async () => {
    const file = join(fixtures, "long.txt")
    const lines: string[] = []
    for (let i = 0; i < 120; i++) lines.push(`line ${i}`)
    writeFileSync(file, lines.join("\n"))
    const chunks = await chunkTextFile(file, "test", fixtures)
    expect(chunks.length).toBe(3)
    expect(chunks[0].heading).toBe("L1-L50")
    expect(chunks[1].heading).toBe("L51-L100")
    expect(chunks[2].heading).toBe("L101-L120")
    unlinkSync(file)
  })

  it("returns empty for files under 5 lines", async () => {
    const file = join(fixtures, "short.txt")
    writeFileSync(file, "a\nb\nc\n")
    const chunks = await chunkTextFile(file, "test", fixtures)
    expect(chunks.length).toBe(0)
    unlinkSync(file)
  })
})

// ── dispatcher tests ──────────────────────────────────

describe("chunkFile dispatcher", () => {
  it("routes .md to markdown chunker", async () => {
    const chunks = await chunkFile(join(fixtures, "sample.md"), "test", fixtures)
    expect(chunks.length).toBeGreaterThan(0)
  })

  it("routes .json to json chunker", async () => {
    const file = join(fixtures, "test.json")
    writeFileSync(file, JSON.stringify({ a: 1, b: "longer value to exceed 50 char minimum threshold for chunking files" }))
    const chunks = await chunkFile(file, "test", fixtures)
    expect(chunks.length).toBe(1)
    unlinkSync(file)
  })
})

// ── walkFiles tests ───────────────────────────────────

describe("walkFiles", () => {
  it("finds .md files by default", () => {
    const files = walkFiles(fixtures, "")
    const mdFiles = files.filter((f: string) => f.endsWith(".md"))
    expect(mdFiles.length).toBeGreaterThan(0)
  })

  it("respects pattern filter", () => {
    const files = walkFiles(fixtures, "*.json.notfound")
    expect(files.length).toBe(0)
  })
})

// ── config tests ──────────────────────────────────────

describe("config", () => {
  it("written config can be read back", () => {
    const dir = mkdtempSync(join(tmpdir(), "rag-test-"))
    const config = { ...DEFAULT_CONFIG, name: "test" }
    writeConfig(dir, config)
    const read = readConfig(dir)
    expect(read.name).toBe("test")
    expect(read.embedModel).toBe(DEFAULT_CONFIG.embedModel)
    rmSync(dir, { recursive: true, force: true })
  })
})
