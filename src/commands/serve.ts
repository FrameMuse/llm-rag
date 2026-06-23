import { requireRagDir } from "../core/ragdir"
import { readConfig, getProjectDir, getDataDir } from "../core/config"
import { startMcpServer } from "../mcp/server"
import { initStore, openTable, dbPath } from "../core/store"
import { watch } from "chokidar"
import { reindexFile, removeFile } from "./index"

export async function serveCommand(watchMode = false): Promise<void> {
  const ragDir = requireRagDir()
  const config = readConfig(ragDir)
  const projectDir = getProjectDir(ragDir)

  if (watchMode) {
    const dataDir = getDataDir(ragDir)
    const conn = await initStore(dbPath(dataDir))
    const table = await openTable(conn, config.name)

    const watcher = watch(projectDir, {
      ignored: /(^|[/\\])(\.|node_modules)/,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    })
    watcher.on("change", (p) => reindexFile(ragDir, config, projectDir, p, conn, table))
    watcher.on("add", (p) => reindexFile(ragDir, config, projectDir, p, conn, table))
    watcher.on("unlink", (p) => removeFile(ragDir, config, projectDir, p, conn, table))
    console.error("rag serve: watching for changes...")

    process.on("SIGINT", () => {
      watcher.close()
      conn.close()
      process.exit(0)
    })
  }

  console.error(`rag serve: starting MCP server for ${ragDir}`)
  await startMcpServer(ragDir)
}
