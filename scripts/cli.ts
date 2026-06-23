function help() {
  console.log(`Usage: rag <command> [args]

Commands:
  init [dir]              Initialize .rag/ in current or specified directory
    --pattern <glob>      File pattern (default: all supported types)
  index                   Chunk, embed, and index files
    --watch               Watch for file changes and re-index
  serve                   Start MCP server (STDIO) for current .rag/
    --watch               Also watch for file changes and re-index
  mcp <tool> [args]       One-shot CLI proxy for MCP tools
  info                    Show index stats
  help                    Show this help

CLI proxy tools (rag mcp):
  config                  Print mcp.json for opencode.json adoption
  search <query>          Semantic search
    [--limit N]           Max results (default 10)
  query <question>        RAG: ask a question, get synthesized answer
  list-documents          List all indexed documents
  get-document <path>     Get full content of a document
`)
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  if (command === "--version" || command === "-v") {
    const pkg = { version: "0.1.0" }
    console.log(`rag v${pkg.version}`)
    return
  }

  if (!command || command === "help" || command === "--help") {
    help()
    return
  }

  switch (command) {
    case "init": {
      const { initCommand } = await import("../src/commands/init")
      await initCommand(args.slice(1))
      break
    }
    case "index": {
      const { indexCommand } = await import("../src/commands/index")
      const watchMode = args.includes("--watch")
      await indexCommand(watchMode)
      break
    }
    case "serve": {
      const { serveCommand } = await import("../src/commands/serve")
      const watchMode = args.includes("--watch")
      await serveCommand(watchMode)
      break
    }
    case "mcp": {
      const { mcpCommand } = await import("../src/commands/mcp")
      await mcpCommand(args.slice(1))
      break
    }
    case "info": {
      const { infoCommand } = await import("../src/commands/info")
      await infoCommand()
      break
    }
    default:
      console.error(`Unknown command: ${command}`)
      console.error("Run `rag help` for usage.")
      process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
