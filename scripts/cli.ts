function help() {
  console.log(`Usage: rag <command> [args]

Commands:
  init [dir]              Initialize .rag/ in current or specified directory
  index                   Chunk, embed, and index .md files
  serve                   Start MCP server (STDIO) for current .rag/
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
      await indexCommand()
      break
    }
    case "serve": {
      const { serveCommand } = await import("../src/commands/serve")
      await serveCommand()
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
