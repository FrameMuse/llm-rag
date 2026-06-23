import { resolve, basename } from "path"
import { ensureRagDir, getProjectDir, writeMcpJson } from "../core/config"

export async function initCommand(args: string[]): Promise<void> {
  let dir = process.cwd()
  let pattern: string | undefined

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--pattern" && i + 1 < args.length) {
      pattern = args[i + 1]
      i++
    } else if (!args[i].startsWith("--")) {
      dir = resolve(args[i])
    }
  }

  const defaultName = basename(dir)
  const name = defaultName

  const ragDir = ensureRagDir(dir, name, pattern)
  const projectDir = getProjectDir(ragDir)

  writeMcpJson(ragDir, {
    [name]: {
      type: "local",
      command: ["rag", "serve"],
      cwd: projectDir,
      enabled: true,
    },
  })

  console.log(`Initialized .rag/ for '${name}' at ${ragDir}`)
  console.log(`  config.json   — index configuration`)
  console.log(`  mcp.json      — MCP server config (for opencode.json)`)
  console.log(`  .gitignore    — excludes binary data from git`)
  if (pattern) console.log(`  pattern:      ${pattern}`)
  console.log()
  console.log("Next: run `rag index` to chunk and embed files.")
}
