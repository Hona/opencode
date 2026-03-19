import { NodeFileSystem } from "@effect/platform-node"
import { dirname, join } from "path"
import { Effect, FileSystem, Layer, Schema, ServiceMap } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { Path } from "../path/path"
import { Glob } from "../util/glob"
import { Filesystem as LocalFilesystem } from "../util/filesystem"

export namespace AppFileSystem {
  export class FileSystemError extends Schema.TaggedErrorClass<FileSystemError>()("FileSystemError", {
    method: Schema.String,
    cause: Schema.optional(Schema.Defect),
  }) {}

  export type Error = PlatformError | FileSystemError

  export interface Interface extends FileSystem.FileSystem {
    readonly isDir: (path: string) => Effect.Effect<boolean, Error>
    readonly isFile: (path: string) => Effect.Effect<boolean, Error>
    readonly readJson: (path: string) => Effect.Effect<unknown, Error>
    readonly writeJson: (path: string, data: unknown, mode?: number) => Effect.Effect<void, Error>
    readonly ensureDir: (path: string) => Effect.Effect<void, Error>
    readonly writeWithDirs: (path: string, content: string | Uint8Array, mode?: number) => Effect.Effect<void, Error>
    readonly findUp: (target: string, start: string, stop?: string) => Effect.Effect<string[], Error>
    readonly up: (options: { targets: string[]; start: string; stop?: string }) => Effect.Effect<string[], Error>
    readonly globUp: (pattern: string, start: string, stop?: string) => Effect.Effect<string[], Error>
    readonly glob: (pattern: string, options?: Glob.Options) => Effect.Effect<string[], Error>
    readonly globMatch: (pattern: string, filepath: string) => boolean
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/FileSystem") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem

      const isDir = Effect.fn("FileSystem.isDir")(function* (path: string) {
        const info = yield* fs.stat(path).pipe(Effect.catch(() => Effect.void))
        return info?.type === "Directory"
      })

      const isFile = Effect.fn("FileSystem.isFile")(function* (path: string) {
        const info = yield* fs.stat(path).pipe(Effect.catch(() => Effect.void))
        return info?.type === "File"
      })

      const readJson = Effect.fn("FileSystem.readJson")(function* (path: string) {
        const text = yield* fs.readFileString(path)
        return JSON.parse(text)
      })

      const writeJson = Effect.fn("FileSystem.writeJson")(function* (path: string, data: unknown, mode?: number) {
        const content = JSON.stringify(data, null, 2)
        yield* fs.writeFileString(path, content)
        if (mode) yield* fs.chmod(path, mode)
      })

      const ensureDir = Effect.fn("FileSystem.ensureDir")(function* (path: string) {
        yield* fs.makeDirectory(path, { recursive: true })
      })

      const writeWithDirs = Effect.fn("FileSystem.writeWithDirs")(function* (
        path: string,
        content: string | Uint8Array,
        mode?: number,
      ) {
        const write = typeof content === "string" ? fs.writeFileString(path, content) : fs.writeFile(path, content)

        yield* write.pipe(
          Effect.catchIf(
            (e) => e.reason._tag === "NotFound",
            () =>
              Effect.gen(function* () {
                yield* fs.makeDirectory(dirname(path), { recursive: true })
                yield* write
              }),
          ),
        )
        if (mode) yield* fs.chmod(path, mode)
      })

      const glob = Effect.fn("FileSystem.glob")(function* (pattern: string, options?: Glob.Options) {
        return yield* Effect.tryPromise({
          try: () => Glob.scan(pattern, options),
          catch: (cause) => new FileSystemError({ method: "glob", cause }),
        })
      })

      const findUp = Effect.fn("FileSystem.findUp")(function* (target: string, start: string, stop?: string) {
        const result: string[] = []
        for (const dir of Path.up(start, { stop })) {
          const search = join(dir, target)
          if (yield* fs.exists(search)) result.push(search)
        }
        return result
      })

      const up = Effect.fn("FileSystem.up")(function* (options: { targets: string[]; start: string; stop?: string }) {
        const result: string[] = []
        for (const dir of Path.up(options.start, { stop: options.stop })) {
          for (const target of options.targets) {
            const search = join(dir, target)
            if (yield* fs.exists(search)) result.push(search)
          }
        }
        return result
      })

      const globUp = Effect.fn("FileSystem.globUp")(function* (pattern: string, start: string, stop?: string) {
        const result: string[] = []
        for (const dir of Path.up(start, { stop })) {
          const matches = yield* glob(pattern, { cwd: dir, absolute: true, include: "file", dot: true }).pipe(
            Effect.catch(() => Effect.succeed([] as string[])),
          )
          result.push(...matches)
        }
        return result
      })

      return Service.of({
        ...fs,
        isDir,
        isFile,
        readJson,
        writeJson,
        ensureDir,
        writeWithDirs,
        findUp,
        up,
        globUp,
        glob,
        globMatch: Glob.match,
      })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(NodeFileSystem.layer))

  // Pure helper that doesn't need Effect.
  export function mimeType(p: string): string {
    return LocalFilesystem.mimeType(p)
  }
}
