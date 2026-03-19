import path from "path"
import { Path } from "@/path/path"

type Opts = {
  cwd?: string
  home?: string
  platform?: NodeJS.Platform | "windows" | "macos" | "linux"
  relative?: boolean
}

function pf(opts: Opts = {}) {
  return Path.platform(opts.platform)
}

function lib(platform: NodeJS.Platform) {
  return platform === "win32" ? path.win32 : path.posix
}

export function formatPath(input?: string, opts: Opts = {}) {
  if (!input) return ""
  return Path.display(input, {
    cwd: opts.cwd,
    home: opts.home ?? false,
    platform: pf(opts),
    relative: opts.relative,
  })
}

export function splitPath(input: string, opts: Pick<Opts, "platform"> = {}) {
  if (!input) return { dir: "", base: "" }

  const mod = lib(pf(opts))
  const parsed = mod.parse(input)
  if (!parsed.base) return { dir: input, base: "" }
  if (!parsed.dir) return { dir: "", base: parsed.base }

  return {
    dir: parsed.dir.endsWith(mod.sep) ? parsed.dir : parsed.dir + mod.sep,
    base: parsed.base,
  }
}

export function plugin(input: string, opts: Pick<Opts, "platform"> = {}) {
  if (!input.startsWith("file://")) {
    const idx = input.lastIndexOf("@")
    if (idx <= 0) return { name: input, version: "latest" }
    return {
      name: input.substring(0, idx),
      version: input.substring(idx + 1),
    }
  }

  const platform = pf(opts)
  const mod = lib(platform)
  const text = String(Path.fromURI(input, { platform }))
  const file = mod.basename(text)
  const ext = mod.extname(file)
  if (!ext) return { name: file }

  const stem = file.slice(0, -ext.length)
  if (stem !== "index") return { name: stem }

  return { name: mod.basename(mod.dirname(text)) || stem }
}
