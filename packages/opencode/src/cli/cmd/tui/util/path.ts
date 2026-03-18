import path from "path"
import { Path } from "@/path/path"

type Opts = {
  cwd?: string
  home?: string
  platform?: NodeJS.Platform
  relative?: boolean
}

function pf(opts: Opts = {}) {
  return opts.platform ?? process.platform
}

function lib(platform: NodeJS.Platform) {
  return platform === "win32" ? path.win32 : path.posix
}

function pretty(input: string, opts: Opts = {}) {
  return String(Path.pretty(input, { cwd: opts.cwd, platform: pf(opts) }))
}

function inside(parent: string, child: string, platform: NodeJS.Platform) {
  const mod = lib(platform)
  const rel = mod.relative(parent, child)
  if (!rel) return true
  if (mod.isAbsolute(rel)) return false
  return !rel.startsWith("..")
}

export function formatPath(input?: string, opts: Opts = {}) {
  if (!input) return ""

  const platform = pf(opts)
  const mod = lib(platform)
  const text = pretty(input, opts)
  if (opts.relative) {
    const cwd = pretty(opts.cwd ?? process.cwd(), { platform })
    if (inside(cwd, text, platform)) return mod.relative(cwd, text) || "."
  }

  const home = opts.home ? pretty(opts.home, { platform }) : undefined
  if (!home) return text
  if (text === home) return "~"
  if (!inside(home, text, platform)) return text

  return `~${mod.sep}${mod.relative(home, text)}`
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
