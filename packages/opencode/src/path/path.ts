import { readdirSync } from "fs"
import { readdir, realpath } from "fs/promises"
import os from "os"
import path from "path"

import { FileURI, PathKey, PosixPath, PrettyPath, RelativePath, RepoPath } from "./schema"

type OS = "windows" | "macos" | "linux"
type Platform = NodeJS.Platform | OS

type Opts = {
  cwd?: string
  platform?: Platform
}

type HomeOpts = {
  home?: string
  platform?: Platform
}

type DisplayOpts = Opts & {
  home?: string | false
  relative?: boolean
}

/**
 * Path exposes a few intentionally different string forms instead of one
 * "normalized" answer.
 *
 * - `pretty` is the main absolute, native-separator form used inside the app.
 * - `key` is the same path folded for equality and map/set lookups.
 * - `canonical` keeps repo and protocol-facing values stable by using POSIX form
 *   for Windows absolute paths while leaving relative inputs alone.
 * - `physical` asks the filesystem for the real on-disk path and best-effort
 *   casing, even when some trailing segments do not exist yet.
 *
 * Windows support also accepts common drive aliases like `/c/...`,
 * `/cygdrive/c/...`, `/mnt/c/...`, plus `file://` URIs, so callers can feed in
 * editor, shell, and URI-derived values without pre-normalizing them first.
 */

type Lib = typeof path.posix

function platformText(input?: Platform) {
  if (!input) return process.platform
  if (input === "windows") return "win32"
  if (input === "macos") return "darwin"
  if (input === "linux") return "linux"
  return input
}

function pf(opts?: { platform?: Platform }) {
  return platformText(opts?.platform)
}

function lib(platform: NodeJS.Platform): Lib {
  return platform === "win32" ? path.win32 : path.posix
}

function home(opts: HomeOpts = {}) {
  return opts.home ?? process.env.OPENCODE_TEST_HOME ?? os.homedir()
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

function winabs(input: string) {
  return (
    input.startsWith("file://") ||
    /^[\\/]{2}[^\\/]/.test(input) ||
    /^[a-zA-Z]:(?:[\\/]|$)/.test(input) ||
    /^\/([a-zA-Z]:|[a-zA-Z])(?:[\\/]|$)/.test(input) ||
    /^\/cygdrive\/[a-zA-Z](?:[\\/]|$)/.test(input) ||
    /^\/mnt\/[a-zA-Z](?:[\\/]|$)/.test(input)
  )
}

function guessText(input: string): NodeJS.Platform | undefined {
  if (input.startsWith("file://")) {
    try {
      const url = new URL(input)
      const host = url.hostname.toLowerCase()
      if (host && host !== "localhost") return "win32"
      if (/^\/([A-Za-z]:|[A-Za-z])(?:[\/]|$)/.test(url.pathname)) return "win32"
      if (/^\/(?:cygdrive|mnt)\/[A-Za-z](?:[\/]|$)/.test(url.pathname)) return "win32"
      return "linux"
    } catch {}
  }
  if (winabs(input)) return "win32"
  if (input.startsWith("/")) return "linux"
}

function base(input: string, platform: NodeJS.Platform) {
  const mod = lib(platform)
  const text = raw(input, platform)
  return clean(mod.isAbsolute(text) ? text : mod.resolve(text), platform)
}

function prettyText(input: string, opts: Opts = {}) {
  const platform = pf(opts)
  const mod = lib(platform)
  const text = raw(input, platform)
  const cwd = opts.cwd ? base(opts.cwd, platform) : undefined
  return clean(cwd ? mod.resolve(cwd, text) : mod.resolve(text), platform)
}

function expandText(input: string, opts: HomeOpts = {}) {
  const platform = pf(opts)
  const mod = lib(platform)
  const dir = home(opts)
  if (input === "~" || input === "$HOME") return prettyText(dir, { platform })
  if (input.startsWith(`~${mod.sep}`)) return prettyText(input.slice(2), { cwd: dir, platform })
  if (input.startsWith(`$HOME${mod.sep}`)) return prettyText(input.slice(6), { cwd: dir, platform })
  if (mod.sep !== "/") {
    if (input.startsWith("~/")) return prettyText(input.slice(2), { cwd: dir, platform })
    if (input.startsWith("$HOME/")) return prettyText(input.slice(6), { cwd: dir, platform })
  }
  return input
}

function inside(parent: string, child: string, platform: NodeJS.Platform) {
  const mod = lib(platform)
  const rel = mod.relative(parent, child)
  if (!rel) return true
  if (mod.isAbsolute(rel)) return false
  return !rel.startsWith("..")
}

function displayText(input: string, opts: DisplayOpts = {}) {
  const platform = pf(opts)
  const mod = lib(platform)
  const text = prettyText(input, opts)
  if (opts.relative) {
    const cwd = prettyText(opts.cwd ?? process.cwd(), { platform })
    if (inside(cwd, text, platform)) return mod.relative(cwd, text) || "."
  }
  if (opts.home === false) return text
  const root = opts.home
  const dir = prettyText(home({ home: root, platform }), { platform })
  if (!inside(dir, text, platform)) return text
  if (text === dir) return "~"
  return `~${mod.sep}${mod.relative(dir, text)}`
}

function encode(input: string) {
  return encodeURIComponent(input)
}

function decode(input: string) {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function repoText(input: string) {
  const dir = /[\\/]$/.test(input)
  const text = path.posix.normalize(input.replaceAll("\\", "/") || ".").replace(/^(?:\.\/)+/, "")
  if (text === ".") return "."
  const clean = text.replace(/\/+$/, "")
  return dir ? `${clean}/` : clean
}

function repoLeaf(input: string) {
  const text = repoText(input).replace(/\/+$/, "")
  if (text === ".") return "."
  return path.posix.basename(text)
}

function repoParentText(input: string) {
  const text = repoText(input).replace(/\/+$/, "")
  if (text === ".") return "."
  return repoText(path.posix.dirname(text) || ".")
}

function hiddenText(input: string) {
  const parts = input.replaceAll("\\", "/").replace(/\/+$/, "").split("/")
  return parts.some(
    (part, idx) => (part.startsWith(".") && part.length > 1) || (part === "." && idx > 0 && idx === parts.length - 1),
  )
}

function fromURIText(input: string, platform: NodeJS.Platform) {
  const url = new URL(input)
  if (url.protocol !== "file:") throw new TypeError(`Expected file URI: ${input}`)
  const host = url.hostname.toLowerCase()
  const text = decode(url.pathname)
  const local = !host || host === "localhost"
  if (platform !== "win32") {
    return `${local ? "" : `//${url.host}`}${text}`
  }
  if (!local) {
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

async function physicalAsync(input: string, opts: Opts = {}): Promise<PrettyPath> {
  const platform = pf(opts)
  const mod = lib(platform)
  const text = prettyText(input, opts)
  const hit = await realpath(text).catch(() => undefined)
  if (hit) return PrettyPath.make(clean(hit, platform))

  const parts: string[] = []
  let dir = text

  while (true) {
    const parent = mod.dirname(dir)
    if (parent === dir) return PrettyPath.make(text)
    parts.unshift(mod.basename(dir))
    const next = await realpath(parent).catch(() => undefined)
    if (next) return PrettyPath.make(clean(mod.join(next, ...parts), platform))
    dir = parent
  }
}

export namespace Path {
  export type Options = Opts

  export function platform(input?: Platform) {
    return platformText(input)
  }

  export function guess(input: string) {
    return guessText(input)
  }

  export function isAbsolute(input: string, opts: Omit<Opts, "cwd"> = {}) {
    const platform = pf(opts)
    return lib(platform).isAbsolute(raw(input, platform))
  }

  /**
   * Returns the absolute app-facing path form.
   *
   * This resolves relative input against `cwd`, expands accepted Windows drive
   * aliases, and preserves the host platform's separator style.
   */
  export function pretty(input: string, opts: Opts = {}) {
    return PrettyPath.make(prettyText(input, opts))
  }

  /**
   * Returns the lookup/equality form for a path.
   *
   * On Windows the key is lower-cased so path comparisons match the
   * filesystem's case-insensitive behavior.
   */
  export function key(input: string, opts: Opts = {}) {
    const platform = pf(opts)
    const text = pretty(input, opts)
    if (platform !== "win32") return PathKey.make(text)
    return PathKey.make(text.toLowerCase())
  }

  export function posix(input: string, opts: Opts = {}) {
    return PosixPath.make(pretty(input, opts).replaceAll("\\", "/"))
  }

  /**
   * Returns a stable serialized form.
   *
   * Windows absolute paths are rewritten to POSIX-style text so values can move
   * across shells, config files, and URIs without backslash ambiguity. Relative
   * paths are left unchanged because their meaning depends on the caller's base.
   */
  export function canonical(input: string, opts: Opts = {}) {
    const platform = pf(opts)
    if (platform !== "win32") return input
    if (!winabs(input)) return input
    return posix(input, opts)
  }

  export function expand(input: string, opts: HomeOpts = {}) {
    return expandText(input, opts)
  }

  /**
   * Returns a user-facing path string.
   *
   * This optionally collapses paths under home to `~` and can render paths
   * relative to `cwd`, but it never changes the underlying filesystem target.
   */
  export function display(input: string, opts: DisplayOpts = {}) {
    return displayText(input, opts)
  }

  export function rel(from: string, to: string, opts: Opts = {}) {
    const platform = pf(opts)
    const mod = lib(platform)
    const text = mod.relative(pretty(from, opts), pretty(to, opts)) || "."
    return RelativePath.make(text)
  }

  export function repo(input: string) {
    return RepoPath.make(repoText(input))
  }

  export function repoParent(input: string) {
    return RepoPath.make(repoParentText(input))
  }

  export function repoName(input: string) {
    return repoLeaf(input)
  }

  export function repoDepth(input: string) {
    const text = repoText(input).replace(/\/+$/, "")
    if (text === ".") return 0
    return text.split("/").filter(Boolean).length
  }

  export function repoIsDir(input: string) {
    const text = repoText(input)
    return text !== "." && text.endsWith("/")
  }

  export function hidden(input: string) {
    return hiddenText(input)
  }

  /**
   * Converts a path to a `file://` URI after first normalizing it with
   * `pretty`, including UNC and Windows drive handling.
   */
  export function uri(input: string, opts: Opts = {}) {
    return FileURI.make(toURIText(pretty(input, opts), pf(opts)))
  }

  /**
   * Parses a `file://` URI into the same absolute native form returned by
   * `pretty`, restoring UNC hosts and Windows drive letters when needed.
   */
  export function fromURI(input: string, opts: Omit<Opts, "cwd"> = {}) {
    return PrettyPath.make(clean(fromURIText(input, pf(opts)), pf(opts)))
  }

  export function eq(a: string, b: string, opts: Opts = {}) {
    return key(a, opts) === key(b, opts)
  }

  /**
   * Checks directory containment after normalizing both inputs into the same
   * platform rules. Relative and absolute paths never match each other.
   */
  export function contains(parent: string, child: string, opts: Opts = {}) {
    const platform = pf(opts)
    const mod = lib(platform)
    const a = raw(parent, platform)
    const b = raw(child, platform)
    if (mod.isAbsolute(a) !== mod.isAbsolute(b)) return false
    const rel = mod.relative(pretty(parent, opts), pretty(child, opts))
    return rel === "" || (!rel.startsWith("..") && !mod.isAbsolute(rel))
  }

  export function externalGlob(dir: string, opts: Opts = {}) {
    return `${posix(dir, opts).replace(/\/+$/, "")}/*`
  }

  export function match(input: string, value: PathKey, opts: Opts = {}) {
    return key(input, opts) === value
  }

  /**
   * Rebuilds the path using the filesystem's recorded casing on Windows.
   *
   * Unlike `physical`, this does not resolve symlinks; it walks segments and
   * keeps any missing tail as provided once the walk can no longer continue.
   */
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

  /**
   * Returns the best available on-disk path.
   *
   * This resolves symlinks via `realpath()` when possible, then falls back to
   * resolving the deepest existing parent so callers still get a useful path for
   * files or directories that are about to be created.
   */
  export const physical = physicalAsync
}
