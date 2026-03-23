import { Filesystem } from "@/util/filesystem"
import { lstatSync, readdirSync, realpathSync } from "fs"
import path from "path"

/**
 * Any legal path text we ingest from the outside world.
 *
 * You might see:
 * - `C:\Users\RUNNER~1\repo`
 * - `C:/Users/runneradmin/repo`
 * - `/c/Users/runneradmin/repo`
 * - `/cygdrive/c/Users/runneradmin/repo`
 *
 * You should not assume:
 * - native separators
 * - canonical casing
 * - long Windows names
 * - symlinks resolved
 * - safe to persist directly
 */
export type RawPath = string & { readonly __raw: unique symbol }

/**
 * Canonical path value we keep in storage and long-lived runtime state.
 *
 * You might see:
 * - `C:\Users\runneradmin\repo`
 * - `C:\Repos\my-link`
 * - `/Users/luke/repo`
 *
 * You should not see:
 * - `RUNNER~1`
 * - `/cygdrive/c/...`
 * - slash-only key forms used just for comparison
 *
 * Stored paths preserve the user's chosen route. They should not resolve
 * symlink, junction, mapped-drive, or UNC roots to some different target.
 */
export type StoredPath = string & { readonly __stored: unique symbol }

const caseMatch = (dir: string, part: string) => {
  try {
    const low = part.toLowerCase()
    return readdirSync(dir).find((item) => item.toLowerCase() === low)
  } catch {
    return
  }
}

const root = (input: string) => input.replace(/^[a-z]:/, (x) => x.toUpperCase())

const storedWin = (input: string) => {
  const full = path.resolve(Filesystem.windowsPath(input))
  const base = root(path.parse(full).root)
  const parts = full
    .slice(base.length)
    .split(/[\\/]+/)
    .filter(Boolean)
  let dir = base

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const next = path.join(dir, part)
    const hit = (() => {
      try {
        return lstatSync(next)
      } catch {
        return
      }
    })()

    if (!hit) return path.join(dir, ...parts.slice(i)) as StoredPath
    if (hit.isSymbolicLink()) {
      dir = path.join(dir, caseMatch(dir, part) ?? part)
      continue
    }

    const name = (() => {
      try {
        return path.basename(realpathSync.native(next))
      } catch {
        return caseMatch(dir, part) ?? part
      }
    })()
    dir = path.join(dir, name)
  }

  return dir as StoredPath
}

export namespace Path {
  export function stored(input: RawPath | string): StoredPath {
    if (!input || input === "/") return input as StoredPath
    if (process.platform !== "win32") return path.resolve(input) as StoredPath
    return storedWin(input)
  }

  export function same(a: RawPath | string, b: RawPath | string) {
    return Filesystem.resolve(stored(a)) === Filesystem.resolve(stored(b))
  }
}
