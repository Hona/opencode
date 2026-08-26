import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, FileSystem, Layer, PlatformError, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/util/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { filesystem } from "@opencode-ai/util/effect/app-node-platform"
import { EnvironmentUnavailable } from "../src/environment/unavailable"
import {
  execDefaults,
  Environment,
  Failed,
  makeFiles,
  makeLocalDriver,
  makeMemoryDriver,
  NotFound,
  typeFollowing,
} from "../src/environment/index"
import { tmpdir } from "./fixture/tmpdir"
import { environmentConformance } from "./lib/environment-conformance"
import { it, testEffect } from "./lib/effect"
import { hostEnvironmentLayer } from "./fixture/environment"

const captureIt = testEffect(Layer.mergeAll(hostEnvironmentLayer, LayerNode.compile(filesystem)))

describe("capture", () => {
  for (const completion of ["exit", "kill", "failed kill"] as const) {
    captureIt.live(`uses the selected spawner and waits for captured output on ${completion}`, () =>
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) =>
          Effect.scoped(
            Effect.gen(function* () {
              const environment = yield* Environment.Service
              const fs = yield* FileSystem.FileSystem
              const writing = yield* Deferred.make<void>()
              const ended = yield* Deferred.make<void>()
              const release = yield* Deferred.make<void>()
              const spawns: ChildProcess.Command[] = []
              const spawner = ChildProcessSpawner.make((command) => {
                spawns.push(command)
                return environment.spawner.spawn(command).pipe(
                  Effect.map((handle) =>
                    ChildProcessSpawner.makeHandle({
                      ...handle,
                      kill: (options) =>
                        completion === "failed kill"
                          ? Effect.fail(
                              PlatformError.systemError({
                                _tag: "NotFound",
                                module: "ChildProcess",
                                method: "kill",
                                description: "Process already exited",
                              }),
                            )
                          : handle.kill(options),
                      all: handle.all.pipe(
                        Stream.tap(() => Deferred.succeed(writing, undefined)),
                        Stream.concat(
                          Stream.fromEffect(
                            Deferred.succeed(ended, undefined).pipe(
                              Effect.andThen(Deferred.await(release)),
                              Effect.as(Buffer.from("tail")),
                            ),
                          ),
                        ),
                      ),
                    }),
                  ),
                )
              })
              const command = ChildProcess.make(
                "node",
                [
                  "-e",
                  completion === "kill"
                    ? 'process.stdout.write("stdout"); process.stderr.write("stderr"); setInterval(() => {}, 60000)'
                    : 'process.stdout.write("stdout"); process.stderr.write("stderr")',
                ],
                { stdin: "ignore" },
              )
              const handle = yield* Environment.capture(command, path.join(tmp.path, "output")).pipe(
                Effect.provideService(Environment.Service, { ...environment, spawner }),
              )
              yield* Deferred.await(writing)
              if (completion === "failed kill") yield* Deferred.await(ended)
              const completed = yield* (completion === "exit" ? handle.exitCode : handle.kill()).pipe(
                Effect.asVoid,
                Effect.exit,
                Effect.forkScoped({ startImmediately: true }),
              )
              yield* Deferred.await(ended)
              expect(completed.pollUnsafe()).toBeUndefined()
              yield* Deferred.succeed(release, undefined)
              expect(Exit.isFailure(yield* Fiber.join(completed))).toBe(completion === "failed kill")
              expect(spawns).toEqual([command])
              const output = yield* fs.readFileString(path.join(tmp.path, "output"))
              expect(output).toContain("stdout")
              expect(output).toContain("stderr")
              expect(output).toEndWith("tail")
              expect(yield* handle.all.pipe(Stream.runCollect)).toEqual([])
            }),
          ),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      ),
    )
  }
})

describe("typeFollowing", () => {
  it.effect("follows symlinks without changing stat semantics", () =>
    Effect.gen(function* () {
      const driver = makeMemoryDriver()
      const files = makeFiles(driver)
      yield* files.mkdir("/directory")
      yield* files.write("/file", new Uint8Array())
      yield* driver.symlink("/directory", "/directory-link")
      yield* driver.symlink("/file", "/file-link")
      yield* driver.symlink("/missing", "/dangling-link")

      expect(yield* typeFollowing(files, "/directory-link")).toBe("directory")
      expect(yield* typeFollowing(files, "/file-link")).toBe("file")
      expect(yield* typeFollowing(files, "/dangling-link").pipe(Effect.flip)).toBeInstanceOf(NotFound)
    }),
  )
})

describe("no execution plane", () => {
  it.effect("fails spawn with a typed location error", () =>
    Effect.gen(function* () {
      const error = yield* EnvironmentUnavailable.spawner.spawn(ChildProcess.make("echo", ["hello"])).pipe(Effect.flip)

      expect(error._tag).toBe("PlatformError")
      expect(error.message).toContain("location has no execution plane")
    }),
  )
})

environmentConformance("memory environment", () =>
  Effect.sync(() => {
    const driver = makeMemoryDriver()
    return {
      files: makeFiles(driver),
      root: `/workspace-${crypto.randomUUID()}`,
      symlink: driver.symlink,
    }
  }),
)

environmentConformance("local environment", () =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const tmp = yield* Effect.promise(() => tmpdir("opencode-local-environment-"))
    return {
      files: makeFiles(makeLocalDriver(spawner)),
      root: tmp.path,
      ...(process.platform === "win32"
        ? {}
        : {
            symlink: (target: string, link: string) =>
              Effect.tryPromise({
                try: () => fs.symlink(target, link),
                catch: (cause) => new Failed({ path: link, cause }),
              }),
          }),
      dispose: Effect.promise(() => tmp[Symbol.asyncDispose]()),
    }
  }).pipe(Effect.provide(LayerNode.compile(CrossSpawnSpawner.node))),
)

environmentConformance(
  "GNU exec environment",
  () =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const tmp = yield* Effect.promise(() => tmpdir("opencode-environment-"))
      return {
        files: execDefaults(spawner),
        root: tmp.path,
        symlink: (target: string, link: string) =>
          Effect.tryPromise({
            try: () => fs.symlink(target, link),
            catch: (cause) => new Failed({ path: link, cause }),
          }),
        dispose: Effect.promise(() => tmp[Symbol.asyncDispose]()),
      }
    }).pipe(Effect.provide(LayerNode.compile(CrossSpawnSpawner.node))),
  process.platform !== "linux",
)
