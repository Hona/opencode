import * as fs from "fs/promises"
import path from "path"
import type { Tool } from "./tool"
import { Instance } from "../project/instance"

type Kind = "file" | "directory"

type Options = {
  kind?: Kind
}

function within(parent: string, child: string) {
  const rel = path.relative(parent, child)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

async function real(input: string) {
  const hit = await fs.realpath(input).catch(() => undefined)
  if (hit) return hit

  const rest: string[] = []
  let dir = input

  while (true) {
    const parent = path.dirname(dir)
    if (parent === dir) return input
    rest.unshift(path.basename(dir))
    const next = await fs.realpath(parent).catch(() => undefined)
    if (next) return path.join(next, ...rest)
    dir = parent
  }
}

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  if (!target) return

  const file = await real(target)
  const dir = await real(Instance.directory)

  if (within(dir, file)) return

  if (Instance.worktree !== "/") {
    const root = await real(Instance.worktree)
    if (within(root, file)) return
  }

  const kind = options?.kind ?? "file"
  const parentDir = kind === "directory" ? file : path.dirname(file)
  const glob = path.join(parentDir, "*").replaceAll("\\", "/")

  await ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: {
      filepath: target,
      parentDir,
    },
  })
}
