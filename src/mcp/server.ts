import { McpServer, StdioServerTransport, fromJsonSchema } from "@modelcontextprotocol/server"
import { join } from "path"
import { readConfig, getProjectDir, getDataDir } from "../core/config"
import { KnowledgeGraph } from "../core/graph"
import * as handlers from "./handlers"

function loadGraph(ragDir: string): KnowledgeGraph | null {
  const dataDir = getDataDir(ragDir)
  const path = join(dataDir, "graph.json")
  const g = new KnowledgeGraph()
  try { g.load(path) } catch { return null }
  return g.nodes.size > 0 ? g : null
}

export async function startMcpServer(ragDir: string): Promise<void> {
  const config = readConfig(ragDir)
  const projectDir = getProjectDir(ragDir)

  const server = new McpServer({ name: "rag", version: "0.1.0" })

  // ── existing tools ────────────────────────────

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
      description: `Ask a question about ${config.name} and get a synthesized answer from document chunks`,
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
    "query_with_graph",
    {
      description: `Ask a question and get an answer synthesized from both document chunks and the knowledge graph context`,
      inputSchema: fromJsonSchema({
        type: "object",
        properties: {
          question: { type: "string", description: "Your question" },
          chunks: { type: "number", description: "Number of chunks to retrieve (default 8)" },
        },
        required: ["question"],
      }),
    },
    async ({ question, chunks }: { question: string; chunks?: number }) => {
      const opts: { graph: boolean; chunks?: number } = { graph: true }
      if (chunks) opts.chunks = chunks
      const result = await handlers.handleQuery(ragDir, projectDir, config, question, opts)
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

  // ── graph tools ──────────────────────────────

  server.registerTool(
    "graph_find",
    {
      description: `Search the knowledge graph of ${config.name} by node name`,
      inputSchema: fromJsonSchema({
        type: "object",
        properties: {
          query: { type: "string", description: "Node name to search" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["query"],
      }),
    },
    async ({ query, limit }: { query: string; limit?: number }) => {
      const g = loadGraph(ragDir)
      if (!g) return { content: [{ type: "text", text: "No graph data available." }] }
      const results = g.find(query)
      return { content: [{ type: "text", text: g.formatFind(results.slice(0, limit ?? 10)) }] }
    },
  )

  server.registerTool(
    "graph_neighbors",
    {
      description: `Show direct connections for a node in the knowledge graph`,
      inputSchema: fromJsonSchema({
        type: "object",
        properties: {
          node: { type: "string", description: "Node name or ID" },
          dir: { type: "string", enum: ["in", "out", "both"], description: "Direction (default both)" },
          type: { type: "string", description: "Filter by edge type (e.g. extends, imports)" },
        },
        required: ["node"],
      }),
    },
    async ({ node, dir, type }: { node: string; dir?: string; type?: string }) => {
      const g = loadGraph(ragDir)
      if (!g) return { content: [{ type: "text", text: "No graph data available." }] }
      const results = g.neighbors(node, (dir as "in" | "out" | "both") || "both", type)
      return { content: [{ type: "text", text: g.formatNeighbors(node, results) }] }
    },
  )

  server.registerTool(
    "graph_god_refs",
    {
      description: `Show the most connected core abstractions in ${config.name}`,
      inputSchema: fromJsonSchema({
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of top nodes (default 10)" },
        },
      }),
    },
    async ({ limit }: { limit?: number }) => {
      const g = loadGraph(ragDir)
      if (!g) return { content: [{ type: "text", text: "No graph data available." }] }
      const results = g.godNodes(limit ?? 10)
      return { content: [{ type: "text", text: g.formatGodNodes(results) }] }
    },
  )

  server.registerTool(
    "graph_path",
    {
      description: `Find the shortest path between two nodes in the knowledge graph`,
      inputSchema: fromJsonSchema({
        type: "object",
        properties: {
          from: { type: "string", description: "Starting node name or ID" },
          to: { type: "string", description: "Target node name or ID" },
        },
        required: ["from", "to"],
      }),
    },
    async ({ from, to }: { from: string; to: string }) => {
      const g = loadGraph(ragDir)
      if (!g) return { content: [{ type: "text", text: "No graph data available." }] }
      const edges = g.path(from, to)
      return { content: [{ type: "text", text: g.formatPath(from, to, edges) }] }
    },
  )

  server.registerTool(
    "graph_communities",
    {
      description: `List all communities in the knowledge graph of ${config.name}`,
      inputSchema: fromJsonSchema({
        type: "object",
        properties: {
          detail: { type: "boolean", description: "If true, show nodes per community" },
        },
      }),
    },
    async ({ detail }: { detail?: boolean }) => {
      const g = loadGraph(ragDir)
      if (!g) return { content: [{ type: "text", text: "No graph data available." }] }
      const communities = g.detectCommunities()
      let text = g.formatCommunities(communities)
      if (detail && communities.size > 0) {
        const first = [...communities.entries()][0]
        const nodes = g.communityNodes(first[0], communities)
        text += `\n\nCommunity ${first[0]} detail:\n${g.formatCommunityDetail(first[0], first[1].label, nodes)}`
      }
      return { content: [{ type: "text", text }] }
    },
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
