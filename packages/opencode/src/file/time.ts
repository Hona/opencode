import { DateTime, Effect, Layer, Semaphore, ServiceMap } from "effect"
import { Path } from "@/path/path"
import type { PathKey, PrettyPath } from "@/path/schema"
import { runPromiseInstance } from "@/effect/runtime"
import { Flag } from "@/flag/flag"
import type { SessionID } from "@/session/schema"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"

export namespace FileTime {
  const log = Log.create({ service: "file.time" })

  export type Stamp = {
    readonly file: PrettyPath
    readonly read: Date
    readonly mtime: number | undefined
    readonly ctime: number | undefined
    readonly size: number | undefined
  }

  const key = (file: PrettyPath) => Path.key(file)

  const stamp = Effect.fnUntraced(function* (file: PrettyPath) {
    const stat = Filesystem.stat(file)
    const size = typeof stat?.size === "bigint" ? Number(stat.size) : stat?.size
    return {
      file,
      read: yield* DateTime.nowAsDate,
      mtime: stat?.mtime?.getTime(),
      ctime: stat?.ctime?.getTime(),
      size,
    }
  })

  const session = (reads: Map<SessionID, Map<PathKey, Stamp>>, sessionID: SessionID) => {
    const value = reads.get(sessionID)
    if (value) return value

    const next = new Map<PathKey, Stamp>()
    reads.set(sessionID, next)
    return next
  }

  export interface Interface {
    readonly read: (sessionID: SessionID, file: PrettyPath) => Effect.Effect<void>
    readonly get: (sessionID: SessionID, file: PrettyPath) => Effect.Effect<Date | undefined>
    readonly assert: (sessionID: SessionID, file: PrettyPath) => Effect.Effect<void>
    readonly withLock: <T>(file: PrettyPath, fn: () => Promise<T>) => Effect.Effect<T>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/FileTime") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const disableCheck = yield* Flag.OPENCODE_DISABLE_FILETIME_CHECK
      const reads = new Map<SessionID, Map<PathKey, Stamp>>()
      const locks = new Map<PathKey, Semaphore.Semaphore>()

      const getLock = (file: PrettyPath) => {
        const id = key(file)
        const lock = locks.get(id)
        if (lock) return lock

        const next = Semaphore.makeUnsafe(1)
        locks.set(id, next)
        return next
      }

      const read = Effect.fn("FileTime.read")(function* (sessionID: SessionID, file: PrettyPath) {
        log.info("read", { sessionID, file })
        session(reads, sessionID).set(key(file), yield* stamp(file))
      })

      const get = Effect.fn("FileTime.get")(function* (sessionID: SessionID, file: PrettyPath) {
        return reads.get(sessionID)?.get(key(file))?.read
      })

      const assert = Effect.fn("FileTime.assert")(function* (sessionID: SessionID, file: PrettyPath) {
        if (disableCheck) return

        const time = reads.get(sessionID)?.get(key(file))
        if (!time) throw new Error(`You must read file ${file} before overwriting it. Use the Read tool first`)

        const next = yield* stamp(file)
        const changed = next.mtime !== time.mtime || next.ctime !== time.ctime || next.size !== time.size
        if (!changed) return

        throw new Error(
          `File ${file} has been modified since it was last read.\nLast modification: ${new Date(next.mtime ?? next.read.getTime()).toISOString()}\nLast read: ${time.read.toISOString()}\n\nPlease read the file again before modifying it.`,
        )
      })

      const withLock = Effect.fn("FileTime.withLock")(function* <T>(file: PrettyPath, fn: () => Promise<T>) {
        return yield* Effect.promise(fn).pipe(getLock(file).withPermits(1))
      })

      return Service.of({ read, get, assert, withLock })
    }),
  )

  export function read(sessionID: SessionID, file: PrettyPath) {
    return runPromiseInstance(Service.use((s) => s.read(sessionID, file)))
  }

  export function get(sessionID: SessionID, file: PrettyPath) {
    return runPromiseInstance(Service.use((s) => s.get(sessionID, file)))
  }

  export async function assert(sessionID: SessionID, file: PrettyPath) {
    return runPromiseInstance(Service.use((s) => s.assert(sessionID, file)))
  }

  export async function withLock<T>(file: PrettyPath, fn: () => Promise<T>): Promise<T> {
    return runPromiseInstance(Service.use((s) => s.withLock(file, fn)))
  }
}
