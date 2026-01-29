import { realpathSync } from "fs"

import path, { toPosix } from "@/util/path"

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
  /**
   * On Windows, normalize a path to its canonical casing using the filesystem.
   * This is needed because Windows paths are case-insensitive but LSP servers
   * may return paths with different casing than what we send them.
   */
  export function normalizePath(p: string): string {
    if (process.platform !== "win32") return p
    try {
      return toPosix(realpathSync.native(toPosix(p)))
    } catch {
      return toPosix(p)
    }
  }

  function root(p: string) {
    const normalized = toPosix(p)

    const drive = normalized.match(/^([a-zA-Z]):\//)
    if (drive) return `${drive[1].toUpperCase()}:/`

    if (!normalized.startsWith("//")) {
      if (normalized.startsWith("/")) return "/"
      return ""
    }

    const parts = normalized.split("/").filter(Boolean)
    if (parts.length < 2) return "//"
    return `//${parts[0]}/${parts[1]}/`
  }
  export function overlaps(a: string, b: string) {
    const relA = path.relative(toPosix(a), toPosix(b))
    const relB = path.relative(toPosix(b), toPosix(a))
    return !relA || !relA.startsWith("..") || !relB || !relB.startsWith("..")
  }

  export function contains(parent: string, child: string) {
    const p = toPosix(parent)
    const c = toPosix(child)

    if (process.platform === "win32") {
      const rp = root(p).toLowerCase()
      const rc = root(c).toLowerCase()
      if (rp && rc && rp !== rc) return false
    }

    const rel = path.relative(p, c)
    if (!rel) return true
    if (rel === ".." || rel.startsWith("../")) return false
    return !path.isAbsolute(rel)
  }

  export async function findUp(target: string, start: string, stop?: string) {
    let current = start
    const result = []
    while (true) {
      const search = path.join(current, target)
      if (await exists(search)) result.push(search)
      if (stop === current) break
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }

  export async function* up(options: { targets: string[]; start: string; stop?: string }) {
    const { targets, start, stop } = options
    let current = start
    while (true) {
      for (const target of targets) {
        const search = path.join(current, target)
        if (await exists(search)) yield search
      }
      if (stop === current) break
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
  }

  export async function globUp(pattern: string, start: string, stop?: string) {
    let current = start
    const result = []
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
          result.push(match)
        }
      } catch {
        // Skip invalid glob patterns
      }
      if (stop === current) break
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }
}
