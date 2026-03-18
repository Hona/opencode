import path from "path"
import type { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Path } from "@/path/path"

type Kind = "file" | "directory"

type Options = {
  kind?: Kind
}

export async function resolveExternalDirectory(target: string, options?: Options) {
  const file = await Path.physical(target)
  const kind = options?.kind ?? "file"
  const parentDir = kind === "directory" ? file : path.dirname(file)
  return {
    file,
    parentDir,
    glob: Path.externalGlob(parentDir),
  }
}

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  if (!target) return

  const hit = await resolveExternalDirectory(target, options)
  const dir = await Path.physical(Instance.directory)

  if (Path.contains(dir, hit.file)) return

  if (Instance.worktree !== "/") {
    const root = await Path.physical(Instance.worktree)
    if (Path.contains(root, hit.file)) return
  }

  await ctx.ask({
    permission: "external_directory",
    patterns: [hit.glob],
    always: [hit.glob],
    metadata: {
      filepath: target,
      parentDir: hit.parentDir,
    },
  })
}
