import { realpathSync } from "fs"
import path from "path"
import { normalize as _normalize, getFilename } from "@opencode-ai/util/path"

const isWin = process.platform === "win32"
const pathImpl = isWin ? path.win32 : path

export namespace Filesystem {
  export const exists = (p: string) =>
    Bun.file(p)
      .stat()
      .then(() => true)
      .catch(() => false)

  export const isDir = (p: string) =>
    Bun.file(p)
      .stat()
      .then((s) => s.isDirectory())
      .catch(() => false)

  export function normalize(p: string) {
    return isWin ? _normalize(p) : p
  }

  /**
   * On Windows, normalize a path to its canonical casing using the filesystem.
   * This is needed because Windows paths are case-insensitive but LSP servers
   * may return paths with different casing than what we send them.
   */
  export function normalizePath(p: string): string {
    if (!isWin) return p
    const input = normalize(p)
    try {
      return _normalize(realpathSync.native(input))
    } catch {
      return input
    }
  }

  export function resolve(...segments: string[]) {
    if (!isWin) return path.resolve(...segments)
    if (segments.length === 0) return ""
    const normalized = segments.map((segment) => normalize(segment))
    const absolute = path.win32.resolve(...normalized)
    return normalize(absolute)
  }

  export function join(...segments: string[]) {
    if (!isWin) return path.join(...segments)
    if (segments.length === 0) return ""
    const normalized = segments.map((segment) => normalize(segment))
    const joined = path.win32.join(...normalized)
    return normalize(joined)
  }

  export function relative(from: string, to: string) {
    const rel = pathImpl.relative(normalize(from), normalize(to))
    return normalize(rel)
  }

  export function dirname(input: string) {
    return normalize(pathImpl.dirname(input))
  }

  export function basename(input: string, ext?: string) {
    if (ext !== undefined) return pathImpl.basename(normalize(input), ext)
    return getFilename(input)
  }

  export function extname(input: string) {
    return pathImpl.extname(normalize(input))
  }

  export function isAbsolute(input: string) {
    return pathImpl.isAbsolute(normalize(input))
  }

  export function overlaps(a: string, b: string) {
    const relA = pathImpl.relative(normalize(a), normalize(b))
    const relB = pathImpl.relative(normalize(b), normalize(a))
    return !relA || !relA.startsWith("..") || !relB || !relB.startsWith("..")
  }

  export function contains(parent: string, child: string) {
    const rel = pathImpl.relative(normalize(parent), normalize(child))
    if (rel === "" || rel === ".") return true
    if (pathImpl.isAbsolute(rel)) return false
    return rel !== ".." && !rel.startsWith(".." + pathImpl.sep)
  }

  export async function findUp(target: string, start: string, stop?: string) {
    let current = normalize(start)
    const result = []
    const end = stop ? normalize(stop) : undefined
    while (true) {
      const search = join(current, target)
      if (await exists(search)) result.push(search)
      if (end === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }

  export async function* up(options: { targets: string[]; start: string; stop?: string }) {
    const { targets, start, stop } = options
    let current = normalize(start)
    const end = stop ? normalize(stop) : undefined
    while (true) {
      for (const target of targets) {
        const search = join(current, target)

        if (await exists(search)) yield search
      }
      if (end === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  }

  export async function globUp(pattern: string, start: string, stop?: string) {
    let current = normalize(start)
    const result = []
    const end = stop ? normalize(stop) : undefined
    while (true) {
      try {
        const glob = new Bun.Glob(pattern)
        for await (const match of glob.scan({
          cwd: current,
          absolute: true,
          onlyFiles: true,
          followSymlinks: true,
          dot: true,
        })) {
          result.push(normalize(match))
        }
      } catch {
        // Skip invalid glob patterns
      }
      if (end === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }
}
