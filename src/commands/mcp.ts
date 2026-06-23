import { requireRagDir } from "../core/ragdir"
import { readConfig, getProjectDir, readMcpJson } from "../core/config"
import * as handlers from "../mcp/handlers"

export async function mcpCommand(args: string[]): Promise<void> {
  const ragDir = requireRagDir()
  const config = readConfig(ragDir)
  const projectDir = getProjectDir(ragDir)

  const tool = args[0]
  if (!tool || tool === "help") {
    console.error("Usage: rag mcp <tool> [args...]")
    console.error("Tools: search, query, list-documents, get-document, config")
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
      const limitIdx = args.indexOf("--limit")
      const limit = limitIdx > 0 ? parseInt(args[limitIdx + 1], 10) || 10 : 10
      const skip = limitIdx > 0 ? [limitIdx, limitIdx + 1] : []
      const query = args.slice(1).filter((_, i) => !skip.includes(i + 1)).join(" ")
      if (!query) {
        console.error("Usage: rag mcp search <query> [--limit N]")
        process.exit(1)
      }
      const result = await handlers.handleSearch(ragDir, projectDir, config, query, limit)
      for (const r of result.results) {
        console.log(`[${r.score.toFixed(2)}] ${r.filePath} > ${r.heading}`)
        console.log(`    ${r.snippet.replace(/\n/g, "\n    ")}`)
        console.log()
      }
      break
    }

    case "query": {
      const question = args.slice(1).join(" ")
      if (!question) {
        console.error("Usage: rag mcp query <question>")
        process.exit(1)
      }
      const result = await handlers.handleQuery(ragDir, projectDir, config, question)
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
      const path = args[1]
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
