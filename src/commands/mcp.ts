import { requireRagDir } from "../core/ragdir"
import { readConfig, getProjectDir, readMcpJson } from "../core/config"
import * as handlers from "../mcp/handlers"

function parseFlags(args: string[]): { positional: string[]; chunks?: number } {
  let chunks: number | undefined
  const skip = new Set<number>()

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--chunks" && i + 1 < args.length) {
      chunks = parseInt(args[i + 1], 10)
      skip.add(i).add(i + 1)
      i++
    } else if (args[i] === "--limit" && i + 1 < args.length) {
      skip.add(i).add(i + 1)
      i++
    }
  }

  const positional = args.filter((_, i) => !skip.has(i))
  return { positional, chunks }
}

export async function mcpCommand(args: string[]): Promise<void> {
  const ragDir = requireRagDir()
  const config = readConfig(ragDir)
  const projectDir = getProjectDir(ragDir)

  const { positional, chunks } = parseFlags(args)

  const tool = positional[0]
  if (!tool || tool === "help") {
    console.error("Usage: rag mcp <tool> [args...]")
    console.error("Tools: search, query, list-documents, get-document, config")
    console.error("Flags: --chunks N, --limit N (for search)")
    process.exit(1)
  }

  switch (tool) {
    case "config": {
      const entry = readMcpJson(ragDir)
      if (!entry) {
        console.error("No mcp.json found in .rag/")
        process.exit(1)
      }
      console.log(JSON.stringify(entry, null, 2))
      break
    }

    case "search": {
      const query = positional.slice(1).join(" ")
      if (!query) {
        console.error("Usage: rag mcp search <query> [--chunks N] [--limit N]")
        process.exit(1)
      }
      const opts: Partial<{ chunks: number }> = {}
      if (chunks) opts.chunks = chunks
      const result = await handlers.handleSearch(ragDir, projectDir, config, query, opts)
      for (const r of result.results) {
        console.log(`[${r.score.toFixed(2)}] ${r.filePath} > ${r.heading}`)
        console.log(`    ${r.snippet.replace(/\n/g, "\n    ")}`)
        console.log()
      }
      break
    }

    case "query": {
      const question = positional.slice(1).join(" ")
      if (!question) {
        console.error("Usage: rag mcp query <question> [--chunks N]")
        process.exit(1)
      }
      const opts: Partial<{ chunks: number }> = {}
      if (chunks) opts.chunks = chunks
      const result = await handlers.handleQuery(ragDir, projectDir, config, question, opts)
      console.log(result.answer)
      console.log()
      console.log("Sources:")
      for (const s of result.sources) {
        console.log(`  [${s.score.toFixed(2)}] ${s.filePath} > ${s.heading}`)
      }
      break
    }

    case "list-documents": {
      const docs = await handlers.handleListDocuments(ragDir, config)
      for (const doc of docs) {
        console.log(doc)
      }
      break
    }

    case "get-document": {
      const path = positional[1]
      if (!path) {
        console.error("Usage: rag mcp get-document <path>")
        process.exit(1)
      }
      const content = await handlers.handleGetDocument(ragDir, projectDir, path)
      console.log(content)
      break
    }

    default:
      console.error(`Unknown tool: ${tool}`)
      console.error("Available: search, query, list-documents, get-document, config")
      process.exit(1)
  }
}
