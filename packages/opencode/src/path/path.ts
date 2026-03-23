import { Filesystem } from "@/util/filesystem"

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
 * - `/Users/luke/repo`
 *
 * You should not see:
 * - `RUNNER~1`
 * - `/cygdrive/c/...`
 * - slash-only key forms used just for comparison
 */
export type StoredPath = string & { readonly __stored: unique symbol }

export namespace Path {
  export function stored(input: RawPath | string): StoredPath {
    if (!input || input === "/") return input as StoredPath
    return Filesystem.resolve(input) as StoredPath
  }
}
