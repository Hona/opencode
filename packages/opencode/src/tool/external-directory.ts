import type { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"

type Kind = "file" | "directory"

type Options = {
  bypass?: boolean
  kind?: Kind
}

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  if (!target) return

  if (options?.bypass) return

  const filepath = Filesystem.normalize(target)
  if (Instance.containsPath(filepath)) return

  const kind = options?.kind ?? "file"
  const baseDir = kind === "directory" ? filepath : Filesystem.dirname(filepath)
  const parentDir = Filesystem.normalize(baseDir)
  const glob = Filesystem.join(parentDir, "/*")

  await ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: {
      filepath,
      parentDir,
    },
  })
}
