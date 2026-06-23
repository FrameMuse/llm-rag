import { resolve, basename } from "path"
import { ensureRagDir, getProjectDir, writeMcpJson } from "../core/config"

export async function initCommand(args: string[]): Promise<void> {
  const dir = args[0] ? resolve(args[0]) : process.cwd()
  const defaultName = basename(dir)
  const name = defaultName

  const ragDir = ensureRagDir(dir, name)
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
  console.log()
  console.log("Next: run `rag index` to chunk and embed files.")
}
