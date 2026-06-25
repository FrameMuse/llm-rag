import { readFileSync, readdirSync, existsSync, writeFileSync } from "fs"
import { join, relative, extname } from "path"
import ts from "typescript"

export interface GraphNode {
  id: string
  type: string
  file: string
  name: string
}

export interface GraphEdge {
  source: string
  target: string
  type: string
}

export class KnowledgeGraph {
  nodes = new Map<string, GraphNode>()
  edges: GraphEdge[] = []

  addNode(id: string, type: string, file: string, name: string): void {
    if (!this.nodes.has(id)) {
      this.nodes.set(id, { id, type, file, name })
    }
  }

  addEdge(source: string, target: string, type: string): void {
    if (source === target) return
    if (this.edges.some((e) => e.source === source && e.target === target && e.type === type)) return
    this.edges.push({ source, target, type })
  }

  // ── extraction ────────────────────────────────────

  extractFromFile(filePath: string, projectDir: string): void {
    const ext = extname(filePath).toLowerCase()
    if (![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) return

    const relPath = relative(projectDir, filePath)
    const sourceText = readFileSync(filePath, "utf-8")
    if (sourceText.trim().length < 50) return

    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true)
    this.addNode(relPath, "file", relPath, relPath)

    for (const node of sourceFile.statements) {
      const name = declName(node)

      if (node.kind === ts.SyntaxKind.SyntaxList) continue

      if (name) {
        const id = `${relPath}::${name}`
        const type = nodeType(node)
        this.addNode(id, type, relPath, name)
        this.addEdge(relPath, id, "defines")

        if (ts.isClassDeclaration(node) && node.heritageClauses) {
          for (const hc of node.heritageClauses) {
            const hcType = hc.token === ts.SyntaxKind.ExtendsKeyword ? "extends" : "implements"
            for (const t of hc.types) {
              const targetName = t.expression.getText(sourceFile)
              const targetId = `${relPath}::${targetName}`
              this.addNode(targetId, "reference", relPath, targetName)
              this.addEdge(id, targetId, hcType)
            }
          }
        }

        if (ts.isClassDeclaration(node) && node.members) {
          for (const member of node.members) {
            if (member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))) {
              const memberName = member.name.text
              const memberId = `${relPath}::${name}.${memberName}`
              this.addNode(memberId, "member", relPath, `${name}.${memberName}`)
              this.addEdge(id, memberId, "contains")
            }
          }
        }
      }

      if (
        ts.isImportDeclaration(node) ||
        ts.isImportEqualsDeclaration(node) ||
        (ts.isExportDeclaration(node) && node.moduleSpecifier)
      ) {
        let moduleName = ""
        if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
          moduleName = node.moduleSpecifier.getText(sourceFile).replace(/['"]/g, "")
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
          moduleName = node.moduleSpecifier.getText(sourceFile).replace(/['"]/g, "")
        }
        if (moduleName) {
          this.addEdge(relPath, moduleName, "imports")
        }
      }
    }
  }

  extractFromProject(projectDir: string, pattern: string): void {
    const files = this.walkFiles(projectDir, pattern)
    for (const f of files) {
      this.extractFromFile(f, projectDir)
    }
  }

  // ── community detection ───────────────────────────

  detectCommunities(): Map<number, { id: string; label: string; nodeCount: number }> {
    const byDir = new Map<string, string[]>()
    for (const n of this.nodes.values()) {
      const dir = n.file.split("/").slice(0, -1).join("/") || n.file.split("/")[0] || "root"
      if (!byDir.has(dir)) byDir.set(dir, [])
      byDir.get(dir)!.push(n.id)
    }

    const communities = new Map<number, { id: string; label: string; nodeCount: number }>()
    let nextId = 0

    for (const [dir, ids] of byDir) {
      const label = dir.split("/").pop() || dir || "unknown"
      const nonFile = ids.filter((id) => {
        const n = this.nodes.get(id)
        return n && n.type !== "file" && n.type !== "member"
      }).length
      if (nonFile > 0) {
        communities.set(nextId++, { id: `community-${nextId}`, label, nodeCount: nonFile })
      }
    }

    return communities
  }

  communityNodes(communityId: number, communities: Map<number, { id: string; label: string; nodeCount: number }>): { name: string; type: string; file: string }[] {
    const target = communities.get(communityId)
    if (!target) return []

    const result: { name: string; type: string; file: string }[] = []
    for (const n of this.nodes.values()) {
      if (n.type === "file" || n.type === "member") continue
      const dir = n.file.split("/").slice(0, -1).join("/") || n.file.split("/")[0] || "root"
      const label = dir.split("/").pop() || dir || "unknown"
      if (label === target.label) {
        result.push({ name: n.name, type: n.type, file: n.file })
      }
    }
    return result
  }

  // ── surprising connections ────────────────────────

  surprisingConnections(limit = 10): { source: string; target: string; type: string; reasons: string[] }[] {
    // Build directory-based communities
    const dirMap = new Map<string, number>()
    const nodeCommunity = new Map<string, number>()
    let comId = 0
    for (const n of this.nodes.values()) {
      const dir = n.file.split("/").slice(0, -1).join("/") || n.file.split("/")[0] || "root"
      if (!dirMap.has(dir)) dirMap.set(dir, comId++)
      nodeCommunity.set(n.id, dirMap.get(dir)!)
    }

    const degree = new Map<string, number>()
    for (const e of this.edges) {
      degree.set(e.source, (degree.get(e.source) || 0) + 1)
      degree.set(e.target, (degree.get(e.target) || 0) + 1)
    }

    const scored: { source: string; target: string; type: string; score: number; reasons: string[] }[] = []

    for (const e of this.edges) {
      const cSrc = nodeCommunity.get(e.source)
      const cTgt = nodeCommunity.get(e.target)
      if (cSrc === undefined || cTgt === undefined || cSrc === cTgt) continue

      const srcNode = this.nodes.get(e.source)
      const tgtNode = this.nodes.get(e.target)
      if (!srcNode || !tgtNode) continue
      if (srcNode.type === "file" || tgtNode.type === "file") continue

      let score = 1
      const reasons: string[] = ["crosses community boundary"]

      const srcDir = srcNode.file.split("/")[0]
      const tgtDir = tgtNode.file.split("/")[0]
      if (srcDir !== tgtDir && srcDir && tgtDir) {
        score += 1
        reasons.push("different top-level directories")
      }

      const degSrc = degree.get(e.source) || 0
      const degTgt = degree.get(e.target) || 0
      if (Math.min(degSrc, degTgt) <= 2 && Math.max(degSrc, degTgt) >= 10) {
        score += 1
        reasons.push("peripheral node reaches hub")
      }

      scored.push({ source: e.source, target: e.target, type: e.type, score, reasons })
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ source, target, type, reasons }) => ({ source, target, type, reasons }))
  }

  // ── god nodes (filtered hubs) ─────────────────────

  godNodes(limit = 10): { id: string; degree: number; node: GraphNode | undefined }[] {
    const degree = new Map<string, number>()
    for (const e of this.edges) {
      degree.set(e.source, (degree.get(e.source) || 0) + 1)
      degree.set(e.target, (degree.get(e.target) || 0) + 1)
    }

    const noise = new Set(["string", "number", "boolean", "any", "void", "null", "undefined", "never", "unknown", "object"])

    return [...degree.entries()]
      .filter(([id]) => {
        const node = this.nodes.get(id)
        if (!node || node.type === "file" || node.type === "member") return false
        if (noise.has(node.name.toLowerCase())) return false
        return true
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, deg]) => ({ id, degree: deg, node: this.nodes.get(id) }))
  }

  // ── import cycle detection ────────────────────────

  findImportCycles(maxCycles = 20): { cycle: string[]; length: number }[] {
    const fileGraph = new Map<string, Set<string>>()
    for (const e of this.edges) {
      if (e.type !== "imports") continue
      const src = this.nodes.get(e.source)?.file || e.source
      if (!fileGraph.has(src)) fileGraph.set(src, new Set())
      fileGraph.get(src)!.add(e.target)
    }

    const cycles: string[][] = []

    function dfs(node: string, path: string[], visited: Set<string>, stack: Set<string>) {
      if (stack.has(node)) {
        const idx = path.indexOf(node)
        cycles.push(path.slice(idx))
        return
      }
      if (visited.has(node) || cycles.length >= maxCycles * 10) return
      visited.add(node)
      stack.add(node)
      path.push(node)
      for (const nb of fileGraph.get(node) || []) {
        dfs(nb, path, visited, stack)
      }
      stack.delete(node)
      path.pop()
    }

    for (const node of fileGraph.keys()) {
      dfs(node, [], new Set(), new Set())
    }

    const seen = new Set<string>()
    const unique: { cycle: string[]; length: number }[] = []

    for (const cycle of cycles.sort((a, b) => a.length - b.length)) {
      if (cycle.length === 0) continue
      const key = cycle.join("::")
      if (seen.has(key)) continue
      seen.add(key)
      unique.push({ cycle, length: cycle.length })
      if (unique.length >= maxCycles) break
    }

    return unique
  }

  // ── queries ───────────────────────────────────────

  neighbors(
    id: string,
    dir: "out" | "in" | "both" = "both",
    type?: string,
  ): { edge: GraphEdge; neighbor: GraphNode }[] {
    const result: { edge: GraphEdge; neighbor: GraphNode }[] = []

    for (const e of this.edges) {
      if (type && e.type !== type) continue
      if (dir === "out" || dir === "both") {
        if (e.source === id) {
          const n = this.nodes.get(e.target)
          if (n) result.push({ edge: e, neighbor: n })
        }
      }
      if (dir === "in" || dir === "both") {
        if (e.target === id) {
          const n = this.nodes.get(e.source)
          if (n) result.push({ edge: e, neighbor: n })
        }
      }
    }
    return result
  }

  path(from: string, to: string): GraphEdge[] {
    const visited = new Set<string>()
    const queue: { id: string; path: GraphEdge[] }[] = [{ id: from, path: [] }]
    visited.add(from)

    while (queue.length > 0) {
      const { id, path } = queue.shift()!
      const nbs = this.neighbors(id, "out")
      for (const { edge, neighbor } of nbs) {
        const newPath = [...path, edge]
        if (neighbor.id === to) return newPath
        if (!visited.has(neighbor.id)) {
          visited.add(neighbor.id)
          queue.push({ id: neighbor.id, path: newPath })
        }
      }
    }
    return []
  }

  find(text: string): GraphNode[] {
    const lower = text.toLowerCase()
    return [...this.nodes.values()].filter(
      (n) => n.name.toLowerCase().includes(lower) || n.id.toLowerCase().includes(lower),
    )
  }

  // ── formatting ────────────────────────────────────

  formatNeighbors(id: string, results: { edge: GraphEdge; neighbor: GraphNode }[]): string {
    if (results.length === 0) return `No connections for "${id}".`
    const lines = [`Connections for "${id}":`]
    for (const { edge, neighbor } of results) {
      lines.push(`  ${edge.type} → ${neighbor.name} (${neighbor.file})`)
    }
    return lines.join("\n")
  }

  formatPath(from: string, to: string, edges: GraphEdge[]): string {
    if (edges.length === 0) return `No path from "${from}" to "${to}".`
    const lines = [`Path from ${from} to ${to}:`]
    let current = from
    for (const e of edges) {
      lines.push(`  ${e.type} → ${e.target === to ? to : e.target}`)
      current = e.target
    }
    return lines.join("\n")
  }

  formatHubs(hubs: { id: string; degree: number; node: GraphNode | undefined }[]): string {
    if (hubs.length === 0) return "No hubs found."
    const lines = ["Hub nodes (most connected):"]
    for (const h of hubs) {
      const name = h.node?.name ?? h.id
      const file = h.node?.file ?? ""
      lines.push(`  ${name} (${h.degree} connections) — ${file}`)
    }
    return lines.join("\n")
  }

  formatGodNodes(results: { id: string; degree: number; node: GraphNode | undefined }[]): string {
    if (results.length === 0) return "No god nodes found."
    const lines = ["God nodes (core abstractions):"]
    for (const r of results) {
      const name = r.node?.name ?? r.id
      const file = r.node?.file ?? ""
      lines.push(`  ${name} — ${r.degree} connections — ${file}`)
    }
    return lines.join("\n")
  }

  formatSurprises(results: { source: string; target: string; type: string; reasons: string[] }[]): string {
    if (results.length === 0) return "No surprising connections found."
    const lines = ["Surprising cross-community connections:"]
    for (const r of results) {
      const src = this.nodes.get(r.source)?.name ?? r.source
      const tgt = this.nodes.get(r.target)?.name ?? r.target
      lines.push(`  ${src} --${r.type}--> ${tgt}`)
      lines.push(`    ${r.reasons.join("; ")}`)
    }
    return lines.join("\n")
  }

  formatCommunities(communities: Map<number, { id: string; label: string; nodeCount: number }>): string {
    if (communities.size === 0) return "No communities found."
    const lines = [`Communities (${communities.size}):`]
    for (const [cid, c] of communities) {
      lines.push(`  ${cid}. "${c.label}" — ${c.nodeCount} nodes`)
    }
    return lines.join("\n")
  }

  formatCommunityDetail(id: number, label: string, nodes: { name: string; type: string; file: string }[]): string {
    if (nodes.length === 0) return `Community ${id} not found.`
    const lines = [`Community ${id} — "${label}" (${nodes.length} nodes):`]
    for (const n of nodes) {
      lines.push(`  ${n.name} — ${n.type} — ${n.file}`)
    }
    return lines.join("\n")
  }

  formatCycles(cycles: { cycle: string[]; length: number }[]): string {
    if (cycles.length === 0) return "No import cycles found."
    const lines = [`Import cycles (${cycles.length} found):`]
    for (let i = 0; i < cycles.length; i++) {
      const c = cycles[i]
      lines.push(`  ${i + 1}. ${c.cycle.join(" → ")} (${c.length} files)`)
    }
    return lines.join("\n")
  }

  formatFind(results: GraphNode[]): string {
    if (results.length === 0) return "No matching nodes."
    const lines = [`Found ${results.length} nodes:`]
    for (const n of results.slice(0, 50)) {
      lines.push(`  ${n.name} — ${n.type} in ${n.file}`)
    }
    if (results.length > 50) lines.push(`  ... and ${results.length - 50} more`)
    return lines.join("\n")
  }

  formatList(): string {
    return `Nodes: ${this.nodes.size}\nEdges: ${this.edges.length}`
  }

  // ── persistence ───────────────────────────────────

  save(jsonPath: string): void {
    writeFileSync(
      jsonPath,
      JSON.stringify({ nodes: [...this.nodes.values()], edges: this.edges }, null, 2),
    )
  }

  load(jsonPath: string): void {
    if (!existsSync(jsonPath)) return
    const data = JSON.parse(readFileSync(jsonPath, "utf-8"))
    for (const n of data.nodes) this.nodes.set(n.id, n)
    this.edges = data.edges || []
  }

  clear(): void {
    this.nodes.clear()
    this.edges = []
  }

  // ── internal ──────────────────────────────────────

  private walkFiles(projectDir: string, _pattern: string): string[] {
    const files: string[] = []
    function walk(dir: string) {
      let entries
      try { entries = readdirSync(dir, { withFileTypes: true }) }
      catch { return }
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "build" || entry.name === "dist") continue
          walk(full)
        } else {
          const ext = extname(entry.name).toLowerCase()
          if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) files.push(full)
        }
      }
    }
    walk(projectDir)
    return files.sort()
  }
}

function declName(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node)) return node.name?.text ?? "(anonymous)"
  if (ts.isClassDeclaration(node)) return node.name?.text ?? "(anonymous)"
  if (ts.isInterfaceDeclaration(node) && node.name) return node.name.text
  if (ts.isTypeAliasDeclaration(node) && node.name) return node.name.text
  if (ts.isEnumDeclaration(node) && node.name) return node.name.text
  if (ts.isModuleDeclaration(node) && node.name) return node.name.text
  return null
}

function nodeType(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node)) return "function"
  if (ts.isClassDeclaration(node)) return "class"
  if (ts.isInterfaceDeclaration(node)) return "interface"
  if (ts.isTypeAliasDeclaration(node)) return "type"
  if (ts.isEnumDeclaration(node)) return "enum"
  if (ts.isModuleDeclaration(node)) return "module"
  return "declaration"
}
