import { McpServer, StdioServerTransport, fromJsonSchema } from "@modelcontextprotocol/server"
import type { RagConfig } from "../core/config"
import { readConfig, getProjectDir } from "../core/config"
import * as handlers from "./handlers"

export async function startMcpServer(ragDir: string): Promise<void> {
  const config = readConfig(ragDir)
  const projectDir = getProjectDir(ragDir)

  const server = new McpServer({ name: "rag", version: "0.1.0" })

  server.registerTool(
    "search",
    {
      description: `Search ${config.name} documents by semantic similarity`,
      inputSchema: fromJsonSchema({
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["query"],
      }),
    },
    async ({ query, limit }: { query: string; limit?: number }) => {
      const result = await handlers.handleSearch(ragDir, projectDir, config, query, limit ?? 10)
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.registerTool(
    "query",
    {
      description: `Ask a question about ${config.name} and get a synthesized answer`,
      inputSchema: fromJsonSchema({
        type: "object",
        properties: {
          question: { type: "string", description: "Your question" },
        },
        required: ["question"],
      }),
    },
    async ({ question }: { question: string }) => {
      const result = await handlers.handleQuery(ragDir, projectDir, config, question)
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.registerTool(
    "list_documents",
    {
      description: `List all indexed documents in ${config.name}`,
      inputSchema: fromJsonSchema({ type: "object", properties: {} }),
    },
    async () => {
      const result = await handlers.handleListDocuments(ragDir, config)
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.registerTool(
    "get_document",
    {
      description: `Get the full content of a document from ${config.name}`,
      inputSchema: fromJsonSchema({
        type: "object",
        properties: {
          path: { type: "string", description: "Document path relative to project root" },
        },
        required: ["path"],
      }),
    },
    async ({ path }: { path: string }) => {
      const result = await handlers.handleGetDocument(ragDir, projectDir, path)
      return { content: [{ type: "text", text: result }] }
    },
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
