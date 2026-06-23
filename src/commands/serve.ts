import { requireRagDir } from "../core/ragdir"
import { startMcpServer } from "../mcp/server"

export async function serveCommand(): Promise<void> {
  const ragDir = requireRagDir()
  console.error(`rag serve: starting MCP server for ${ragDir}`)
  await startMcpServer(ragDir)
}
