import path from "path"
import { Path } from "@/path/path"

type Opts = {
  cwd?: string
  home?: string
  platform?: NodeJS.Platform | "windows" | "macos" | "linux"
  relative?: boolean
}

type Server = {
  directory?: string
  home?: string
  os?: Opts["platform"]
}

function pf(opts: Opts = {}) {
  return Path.platform(opts.platform)
}

function lib(platform: NodeJS.Platform) {
  return platform === "win32" ? path.win32 : path.posix
}

function text(input?: string) {
  return input || undefined
}

export function serverPathOpts(input: Server, opts: Pick<Opts, "relative"> = {}): Opts {
  const cwd = text(input.directory)
  return {
    cwd,
    home: text(input.home),
    platform: input.os,
    relative: opts.relative && !!cwd,
  }
}

export function formatServerPath(input: string | undefined, server: Server, opts: Pick<Opts, "relative"> = {}) {
  if (!input) return ""

  const cfg = serverPathOpts(server, opts)
  const platform = pf(cfg)
  if (cfg.cwd || Path.isAbsolute(input, { platform })) {
    return formatPath(input, cfg)
  }

  if (platform === "win32") return path.win32.normalize(input)
  return path.posix.normalize(input.replaceAll("\\", "/"))
}

export function serverPathKey(input: string, server: Server) {
  const opts = serverPathOpts(server)
  const platform = pf(opts)
  if (opts.cwd || Path.isAbsolute(input, { platform })) {
    return String(Path.key(input, { cwd: opts.cwd, platform }))
  }

  const text = String(Path.repo(input))
  if (platform !== "win32") return text
  return text.toLowerCase()
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
