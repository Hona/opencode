import { CrossSpawnSpawner } from "@opencode-ai/util/cross-spawn-spawner"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Fiber, FileSystem, Layer, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner, makeHandle } from "effect/unstable/process/ChildProcessSpawner"
import type { Files } from "./files.js"
import { makeFiles } from "./index.js"
import { makeLocalDriver } from "./local.js"
import { Location } from "../location.js"
import { Workspace } from "../workspace.js"

export interface Interface {
  readonly files: Files
  readonly spawner: ChildProcessSpawner["Service"]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Environment") {}

/** Capture owns stdout/stderr; exit and kill complete only after captured output is readable. */
export const capture = Effect.fn("Environment.capture")(function* (
  command: ChildProcess.StandardCommand,
  output: string,
) {
  const environment = yield* Service
  const spawner = environment.spawner
  if (CrossSpawnSpawner.supportsFileOutput(spawner)) return yield* spawner.spawnToFile(command, output)

  const fs = yield* FileSystem.FileSystem
  const file = yield* fs.open(output, { flag: "w" })
  const handle = yield* spawner.spawn(command)
  const writer = yield* handle.all.pipe(
    Stream.runForEach((chunk) => file.writeAll(chunk)),
    Effect.forkScoped,
  )
  const complete = <A, E>(operation: Effect.Effect<A, E>) =>
    Effect.all([Effect.exit(operation), Fiber.join(writer)], { concurrency: "unbounded" }).pipe(
      Effect.flatMap(([exit]) => exit),
    )
  return makeHandle({
    ...handle,
    stdout: Stream.empty,
    stderr: Stream.empty,
    all: Stream.empty,
    exitCode: complete(handle.exitCode),
    kill: (options) => complete(handle.kill(options)),
  })
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    const location = yield* Location.Service
    const workspace = yield* Workspace.Service
    const driver = location.workspaceID
      ? yield* workspace.connect(location.workspaceID).pipe(
          // Environment has no error channel; an unknown or destroyed placement is a configuration defect by design.
          Effect.mapError(
            (cause) => new Error(`Failed to bind Environment to workspace ${location.workspaceID}`, { cause }),
          ),
          Effect.orDie,
        )
      : makeLocalDriver(spawner)
    return Service.of({ files: makeFiles(driver), spawner: driver.spawner })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [CrossSpawnSpawner.node, Location.node, Workspace.node],
})

export * as EnvironmentService from "./environment.js"
