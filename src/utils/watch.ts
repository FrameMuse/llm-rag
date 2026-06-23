import { execSync } from "child_process"
import { existsSync } from "fs"
import { join, relative } from "path"

export function getIgnoredFiles(projectDir: string): (path: string) => boolean {
  const ignoredPaths = new Set<string>()

  try {
    if (existsSync(join(projectDir, ".git"))) {
      const out = execSync(
        "git ls-files --others --ignored --exclude-standard",
        { cwd: projectDir, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
      )
      for (const line of out.trim().split("\n").filter(Boolean)) {
        const abs = join(projectDir, line)
        if (abs !== projectDir) ignoredPaths.add(abs)
      }
    }
  } catch {
    // git not available — use defaults only
  }

  return (filePath: string) => {
    if (/(^|[/\\])(\.|node_modules)/.test(filePath)) return true
    return ignoredPaths.has(filePath)
  }
}
