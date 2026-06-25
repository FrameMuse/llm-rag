import { join } from "path"
import { requireRagDir } from "../core/ragdir"
import { readConfig, getProjectDir, getDataDir } from "../core/config"
import { KnowledgeGraph } from "../core/graph"

function graphPath(dataDir: string): string {
  return join(dataDir, "graph.json")
}

export function loadGraph(ragDir: string): KnowledgeGraph | null {
  const dataDir = getDataDir(ragDir)
  const path = graphPath(dataDir)
  const g = new KnowledgeGraph()
  try {
    g.load(path)
  } catch {
    return null
  }
  if (g.nodes.size === 0) return null
  return g
}

export async function buildGraphCommand(): Promise<void> {
  const ragDir = requireRagDir()
  const config = readConfig(ragDir)
  const projectDir = getProjectDir(ragDir)

  console.log(`Building knowledge graph for '${config.name}'...`)
  const g = new KnowledgeGraph()
  g.extractFromProject(projectDir, config.pattern)
  const dataDir = getDataDir(ragDir)
  g.save(graphPath(dataDir))
  console.log(`  Nodes: ${g.nodes.size}`)
  console.log(`  Edges: ${g.edges.length}`)
}

export function buildGraph(ragDir: string, config: import("../core/config").RagConfig, projectDir: string): void {
  const g = new KnowledgeGraph()
  g.extractFromProject(projectDir, config.pattern)
  const dataDir = getDataDir(ragDir)
  g.save(graphPath(dataDir))
}

export async function graphMcpCommand(args: string[]): Promise<void> {
  const ragDir = requireRagDir()
  const config = readConfig(ragDir)
  const projectDir = getProjectDir(ragDir)

  const g = loadGraph(ragDir)
  if (!g) {
    console.log("No graph data. Run `rag graph build` or `rag index` first.")
    return
  }

  const sub = args[0]
  if (!sub || sub === "help") {
    console.log(`Usage: rag mcp graph <subcommand> [args]

Subcommands:
  neighbors <node>        Show connections for a node
    --dir in|out|both     Direction (default: both)
    --type <edgeType>     Filter by edge type
  path <from> <to>        Find shortest path
  hubs [--limit N]        Show most connected nodes
  find <text>             Search nodes by name
  list                    Show node/edge counts
  help                    Show this help`)
    return
  }

  switch (sub) {
    case "list": {
      console.log(g.formatList())
      break
    }

    case "neighbors": {
      const id = args[1]
      if (!id) {
        console.log("Usage: rag mcp graph neighbors <node> [--dir in|out|both] [--type <type>]")
        return
      }
      const dirIdx = args.indexOf("--dir")
      const dir = dirIdx > 0 ? (args[dirIdx + 1] as "in" | "out" | "both") : "both"
      const typeIdx = args.indexOf("--type")
      const type = typeIdx > 0 ? args[typeIdx + 1] : undefined
      const results = g.neighbors(id, dir, type)
      console.log(g.formatNeighbors(id, results))
      break
    }

    case "path": {
      const from = args[1]
      const to = args[2]
      if (!from || !to) {
        console.log("Usage: rag mcp graph path <from> <to>")
        return
      }
      const p = g.path(from, to)
      console.log(g.formatPath(from, to, p))
      break
    }

    case "hubs": {
      const limitIdx = args.indexOf("--limit")
      const limit = limitIdx > 0 ? parseInt(args[limitIdx + 1], 10) || 10 : 10
      const hubs = g.hubs(limit)
      console.log(g.formatHubs(hubs))
      break
    }

    case "find": {
      const text = args.slice(1).join(" ")
      if (!text) {
        console.log("Usage: rag mcp graph find <text>")
        return
      }
      const results = g.find(text)
      console.log(g.formatFind(results))
      break
    }

    default:
      console.log(`Unknown graph subcommand: ${sub}`)
      console.log("Available: list, neighbors, path, hubs, find")
  }
}
