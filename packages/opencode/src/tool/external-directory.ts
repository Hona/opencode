import path from "@/util/path"
import type { Tool } from "./tool"
import { Instance } from "../project/instance"

type Kind = "file" | "directory"

type Options = {
  bypass?: boolean
  kind?: Kind
}

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  if (!target) return

  if (options?.bypass) return

  const filepath = path.toPosix(target)

  if (Instance.containsPath(filepath)) return

  const kind = options?.kind ?? "file"
  const parentDir = kind === "directory" ? filepath : path.dirname(filepath)
  const glob = path.join(parentDir, "*")

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
