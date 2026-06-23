import { resolve, basename } from "path"
import { existsSync } from "fs"
import { ensureRagDir, getProjectDir, writeMcpJson, readConfig, writeConfig } from "../core/config"

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

  if (existsSync(resolve(dir, ".rag", "config.json"))) {
    console.log(".rag/ already exists. Updating pattern and name...")
    const existingDir = resolve(dir, ".rag")
    const config = readConfig(existingDir)
    if (pattern) config.pattern = pattern
    config.name = defaultName
    writeConfig(existingDir, config)
    writeMcpJson(existingDir, {
      [defaultName]: {
        type: "local",
        command: ["rag", "serve"],
        cwd: dir,
        enabled: true,
      },
    })
    console.log(`Updated .rag/ for '${defaultName}' at ${existingDir}`)
    return
  }

  const ragDir = ensureRagDir(dir, defaultName, pattern)
  const projectDir = getProjectDir(ragDir)

  writeMcpJson(ragDir, {
    [defaultName]: {
      type: "local",
      command: ["rag", "serve"],
      cwd: projectDir,
      enabled: true,
    },
  })

  console.log(`Initialized .rag/ for '${defaultName}' at ${ragDir}`)
  console.log(`  config.json   — index configuration`)
  console.log(`  mcp.json      — MCP server config (for opencode.json)`)
  console.log(`  .gitignore    — excludes binary data from git`)
  if (pattern) console.log(`  pattern:      ${pattern}`)
  console.log()
  console.log("Next: run `rag index` to chunk and embed files.")
}
