import { readdirSync } from "fs"
import { readdir } from "fs/promises"
import path from "path"

import { FileURI, PathKey, PosixPath, PrettyPath, RelativePath } from "./schema"

type Opts = {
  cwd?: string
  platform?: NodeJS.Platform
}

type Lib = typeof path.posix

function pf(opts?: { platform?: NodeJS.Platform }) {
  return opts?.platform ?? process.platform
}

function lib(platform: NodeJS.Platform): Lib {
  return platform === "win32" ? path.win32 : path.posix
}

function fixDrive(input: string) {
  return input.replace(/^[a-z]:/, (match) => match.toUpperCase())
}

function clean(input: string, platform: NodeJS.Platform) {
  const text = lib(platform).normalize(input)
  if (platform !== "win32") return text
  return fixDrive(text).replaceAll("/", "\\")
}

function raw(input: string, platform: NodeJS.Platform) {
  if (input.startsWith("file://")) return fromURIText(input, platform)
  if (platform !== "win32") return input
  return input
    .replace(/^\/([a-zA-Z]):(?:[\\/]|$)/, (_, drive) => `${drive.toUpperCase()}:\\`)
    .replace(/^\/([a-zA-Z])(?:[\\/]|$)/, (_, drive) => `${drive.toUpperCase()}:\\`)
    .replace(/^\/cygdrive\/([a-zA-Z])(?:[\\/]|$)/, (_, drive) => `${drive.toUpperCase()}:\\`)
    .replace(/^\/mnt\/([a-zA-Z])(?:[\\/]|$)/, (_, drive) => `${drive.toUpperCase()}:\\`)
}

function base(input: string, platform: NodeJS.Platform) {
  const mod = lib(platform)
  const text = raw(input, platform)
  return clean(mod.isAbsolute(text) ? text : mod.resolve(text), platform)
}

function encode(input: string) {
  return encodeURIComponent(input)
}

function fromURIText(input: string, platform: NodeJS.Platform) {
  const url = new URL(input)
  if (url.protocol !== "file:") throw new TypeError(`Expected file URI: ${input}`)
  const text = decodeURIComponent(url.pathname)
  if (platform !== "win32") {
    return `${url.host ? `//${url.host}` : ""}${text}`
  }
  if (url.host) {
    return `\\\\${url.host}${text.replaceAll("/", "\\")}`
  }
  return fixDrive(text.replace(/^\/([a-zA-Z]:)/, "$1").replaceAll("/", "\\"))
}

function toURIText(input: string, platform: NodeJS.Platform) {
  if (platform !== "win32") {
    return `file://${input.split("/").map((part, idx) => (idx === 0 ? part : encode(part))).join("/")}`
  }
  if (input.startsWith("\\\\")) {
    const parts = input.slice(2).split("\\")
    const host = parts.shift() ?? ""
    const body = parts.map(encode).join("/")
    return `file://${host}/${body}`
  }
  const text = input.replaceAll("\\", "/")
  const body = text
    .slice(2)
    .split("/")
    .map((part, idx) => (idx === 0 ? part : encode(part)))
    .join("/")
  return `file:///${fixDrive(text.slice(0, 2))}${body}`
}

export namespace Path {
  export type Options = Opts

  export function pretty(input: string, opts: Opts = {}) {
    const platform = pf(opts)
    const mod = lib(platform)
    const text = raw(input, platform)
    const cwd = opts.cwd ? base(opts.cwd, platform) : undefined
    return PrettyPath.make(clean(cwd ? mod.resolve(cwd, text) : mod.resolve(text), platform))
  }

  export function key(input: string, opts: Opts = {}) {
    const platform = pf(opts)
    const text = pretty(input, opts)
    if (platform !== "win32") return PathKey.make(text)
    return PathKey.make(text.toLowerCase())
  }

  export function posix(input: string, opts: Opts = {}) {
    return PosixPath.make(pretty(input, opts).replaceAll("\\", "/"))
  }

  export function rel(from: string, to: string, opts: Opts = {}) {
    const platform = pf(opts)
    const mod = lib(platform)
    const text = mod.relative(pretty(from, opts), pretty(to, opts)) || "."
    return RelativePath.make(text)
  }

  export function uri(input: string, opts: Opts = {}) {
    return FileURI.make(toURIText(pretty(input, opts), pf(opts)))
  }

  export function fromURI(input: string, opts: Omit<Opts, "cwd"> = {}) {
    return PrettyPath.make(clean(fromURIText(input, pf(opts)), pf(opts)))
  }

  export function eq(a: string, b: string, opts: Opts = {}) {
    return key(a, opts) === key(b, opts)
  }

  export function match(input: string, value: PathKey, opts: Opts = {}) {
    return key(input, opts) === value
  }

  export async function truecase(input: string, opts: Omit<Opts, "cwd"> = {}) {
    const platform = pf(opts)
    const text = pretty(input, opts)
    if (platform !== "win32") return text

    const mod = path.win32
    const root = mod.parse(text).root
    const rest = text.slice(root.length).split("\\").filter(Boolean)
    let out = root

    for (const [idx, seg] of rest.entries()) {
      const list = await readdir(out).catch(() => undefined)
      if (!list) return PrettyPath.make(clean(mod.join(out, ...rest.slice(idx)), platform))

      const hit = list.find((item) => item.toLowerCase() === seg.toLowerCase())
      if (!hit) return PrettyPath.make(clean(mod.join(out, ...rest.slice(idx)), platform))

      out = mod.join(out, hit)
    }

    return PrettyPath.make(clean(out, platform))
  }

  export function truecaseSync(input: string, opts: Omit<Opts, "cwd"> = {}) {
    const platform = pf(opts)
    const text = pretty(input, opts)
    if (platform !== "win32") return text

    const mod = path.win32
    const root = mod.parse(text).root
    const rest = text.slice(root.length).split("\\").filter(Boolean)
    let out = root

    for (const [idx, seg] of rest.entries()) {
      let list: string[] | undefined
      try {
        list = readdirSync(out)
      } catch {
        return PrettyPath.make(clean(mod.join(out, ...rest.slice(idx)), platform))
      }

      const hit = list.find((item) => item.toLowerCase() === seg.toLowerCase())
      if (!hit) return PrettyPath.make(clean(mod.join(out, ...rest.slice(idx)), platform))

      out = mod.join(out, hit)
    }

    return PrettyPath.make(clean(out, platform))
  }
}
