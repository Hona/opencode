import z from "zod"
import { Tool } from "./tool"
import * as path from "path"
import DESCRIPTION from "./ls.txt"
import { Instance } from "../project/instance"
import { Ripgrep } from "../file/ripgrep"
import { assertExternalDirectory } from "./external-directory"
import { Path } from "@/path/path"

export const IGNORE_PATTERNS = [
  "node_modules/",
  "__pycache__/",
  ".git/",
  "dist/",
  "build/",
  "target/",
  "vendor/",
  "bin/",
  "obj/",
  ".idea/",
  ".vscode/",
  ".zig-cache/",
  "zig-out",
  ".coverage",
  "coverage/",
  "vendor/",
  "tmp/",
  "temp/",
  ".cache/",
  "cache/",
  "logs/",
  ".venv/",
  "venv/",
  "env/",
]

const LIMIT = 100

export const ListTool = Tool.define("list", {
  description: DESCRIPTION,
  parameters: z.object({
    path: z.string().describe("The absolute path to the directory to list (must be absolute, not relative)").optional(),
    ignore: z.array(z.string()).describe("List of glob patterns to ignore").optional(),
  }),
  async execute(params, ctx) {
    const searchPath = Path.pretty(params.path ?? ".", { cwd: Instance.directory })
    await assertExternalDirectory(ctx, searchPath, { kind: "directory" })

    await ctx.ask({
      permission: "list",
      patterns: [searchPath],
      always: ["*"],
      metadata: {
        path: searchPath,
      },
    })

    const ignoreGlobs = IGNORE_PATTERNS.map((p) => `!${p}*`).concat(params.ignore?.map((p) => `!${p}`) || [])
    const files = []
    for await (const file of Ripgrep.files({ cwd: searchPath, glob: ignoreGlobs, signal: ctx.abort })) {
      files.push(String(Path.repo(file)))
      if (files.length >= LIMIT) break
    }

    const dirs = new Set<string>(["."])
    const filesByDir = new Map<string, string[]>()

    for (const file of files) {
      const dir = String(Path.repoParent(file))
      let current = dir
      while (true) {
        dirs.add(current)
        if (current === ".") break
        current = String(Path.repoParent(current))
      }

      if (!filesByDir.has(dir)) filesByDir.set(dir, [])
      filesByDir.get(dir)!.push(Path.repoName(file))
    }

    function renderDir(dirPath: string, depth: number): string {
      const indent = "  ".repeat(depth)
      let output = ""

      if (depth > 0) {
        output += `${indent}${Path.repoName(dirPath)}/\n`
      }

      const childIndent = "  ".repeat(depth + 1)
      const children = Array.from(dirs)
        .filter((d) => d !== "." && d !== dirPath && String(Path.repoParent(d)) === dirPath)
        .sort()

      for (const child of children) {
        output += renderDir(child, depth + 1)
      }

      const files = filesByDir.get(dirPath) || []
      for (const file of files.sort()) {
        output += `${childIndent}${file}\n`
      }

      return output
    }

    const root = searchPath.endsWith(path.sep) ? searchPath : searchPath + path.sep
    const output = `${root}\n` + renderDir(".", 0)

    return {
      title: String(Path.rel(Instance.worktree, searchPath)),
      metadata: {
        count: files.length,
        truncated: files.length >= LIMIT,
      },
      output,
    }
  },
})
