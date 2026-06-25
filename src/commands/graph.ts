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
  console.log(`  Refs: ${g.nodes.size}`)
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
  const _config = readConfig(ragDir)
  const _projectDir = getProjectDir(ragDir)

  const g = loadGraph(ragDir)
  if (!g) {
    console.log("No graph data. Run `rag graph build` or `rag index` first.")
    return
  }

  const sub = args[0]
  const showSig = args.includes("--signature")
  if (!sub || sub === "help") {
    console.log(`Usage: rag mcp graph <subcommand> [args]

Subcommands:
  neighbors <node>        Show connections for a node
    --dir in|out|both     Direction (default: both)
    --type <edgeType>     Filter by edge type
    --signature           Show declaration signatures
  path <from> <to>        Find shortest path
  god-refs [--limit N]    Most connected core abstractions
    --signature           Show declaration signatures
  hubs [--limit N]        Alias for god-refs
  communities             List all communities
  community <id>          Show nodes in a community
  surprises [--limit N]   Cross-community connections
  cycles                  Import cycle detection
  find <text>             Search references
    --signature           Show declaration signatures
  list                    Node/edge counts
  help                    Show this help`)
    return
  }

  const known = [
    "list", "neighbors", "path", "god-refs", "god-nodes", "hubs",
    "find", "communities", "community", "surprises", "cycles", "help",
  ]

  // Free-form query: show everything about a topic
  if (sub && !known.includes(sub)) {
    const limitIdx = args.indexOf("--limit")
    const limit = limitIdx > 0 ? parseInt(args[limitIdx + 1], 10) || 10 : 10
    const skipFlags = new Set(["--signature", "--limit", limitIdx > 0 ? args[limitIdx + 1] : ""])
    const query = args.filter((a) => !skipFlags.has(a)).join(" ")

    const results = g.find(query)
    if (results.length === 0) {
      console.log("No matching references.")
      return
    }

    console.log(g.formatFind(results.slice(0, limit), showSig))

    // Pick top meaningful match
    const top = results.find((r) => r.type !== "file" && r.type !== "heading") || results[0]

    if (!top) return

    console.log(`\nTop match: ${top.name}`)
    console.log(`  Type: ${top.type}`)
    console.log(`  File: ${top.file}`)
    if (showSig && top.signature) console.log(`  Signature: ${top.signature}`)

    const conn = g.neighbors(top.id)
    if (conn.length > 0) {
      console.log(`\n  Connections (${conn.length}):`)
      for (const { edge, neighbor } of conn.slice(0, 15)) {
        const label = showSig && neighbor.signature ? neighbor.signature : neighbor.name
        console.log(`    ${edge.type} → ${label} (${neighbor.type})`)
      }
    }

    const communities = g.detectCommunities()
    const topCommunity = [...communities.entries()].find(([_, c]) =>
      top.file.startsWith(c.label) || top.file.split("/")[0] === c.label,
    )
    if (topCommunity) {
      console.log(`\n  Community: "${topCommunity[1].label}" (${topCommunity[1].nodeCount} refs)`)
    }

    const allGod = g.godNodes(100)
    const godRank = allGod.findIndex((r) => r.id === top.id)
    if (godRank >= 0) {
      console.log(`  God rank: #${godRank + 1} (${allGod[godRank].degree} connections)`)
    }

    const surprises = g.surprisingConnections().filter((s) => s.source === top.id || s.target === top.id)
    if (surprises.length > 0) {
      console.log(`\n  Surprising connections:`)
      for (const s of surprises) {
        const src = g.nodes.get(s.source)?.name ?? s.source
        const tgt = g.nodes.get(s.target)?.name ?? s.target
        console.log(`    ${src} --${s.type}--> ${tgt}`)
        console.log(`    → ${s.reasons.join("; ")}`)
      }
    }

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
      console.log(g.formatNeighbors(id, results, showSig))
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

    case "god-refs":
    case "god-nodes":
    case "hubs": {
      const limitIdx = args.indexOf("--limit")
      const limit = limitIdx > 0 ? parseInt(args[limitIdx + 1], 10) || 10 : 10
      const results = g.godNodes(limit)
      console.log(g.formatGodNodes(results, showSig))
      break
    }

    case "find": {
      const text = args.slice(1).filter((a) => a !== "--signature").join(" ")
      if (!text) {
        console.error("Usage: rag mcp graph find <text>")
        return
      }
      const results = g.find(text)
      console.log(g.formatFind(results, showSig))
      break
    }

    case "communities": {
      const communities = g.detectCommunities()
      console.log(g.formatCommunities(communities))
      break
    }

    case "community": {
      const id = parseInt(args[1], 10)
      if (isNaN(id)) {
        console.log("Usage: rag mcp graph community <id>")
        return
      }
      const communities = g.detectCommunities()
      const c = communities.get(id)
      if (!c) {
        console.log(`Community ${id} not found.`)
        return
      }
      const nodes = g.communityNodes(id, communities)
      console.log(g.formatCommunityDetail(id, c.label, nodes))
      break
    }

    case "surprises": {
      const limitIdx = args.indexOf("--limit")
      const limit = limitIdx > 0 ? parseInt(args[limitIdx + 1], 10) || 10 : 10
      const results = g.surprisingConnections(limit)
      console.log(g.formatSurprises(results))
      break
    }

    case "cycles": {
      const cycles = g.findImportCycles()
      console.log(g.formatCycles(cycles))
      break
    }

    default:
      console.log(`Unknown graph subcommand: ${sub}`)
      console.log("Available: list, neighbors, path, god-refs, hubs, find, communities, community, surprises, cycles")
  }
}
