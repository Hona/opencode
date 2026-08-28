import { Global } from "@opencode-ai/util/global"
import { Effect, Queue, Schedule } from "effect"
import path from "node:path"

export const listen = Effect.gen(function* () {
  const global = yield* Global.Service
  const signals = yield* Queue.dropping<void>(1)
  const handler = () => Queue.offerUnsafe(signals, undefined)
  if (process.platform === "win32") {
    // Detached Windows servers have no console for CTRL_BREAK_EVENT/SIGBREAK.
    yield* Effect.gen(function* () {
      const { createEvent } = yield* Effect.promise(() => import("#heap-event"))
      const event = yield* Effect.acquireRelease(
        Effect.try(() => createEvent(`Local\\opencode-heap-${process.pid}`)),
        (event) => Effect.sync(() => event.close()),
      )
      // A zero-timeout native wait avoids blocking JS or allocating a worker VM.
      yield* Effect.try(() => event.poll()).pipe(
        Effect.tap((signaled) => (signaled ? Effect.sync(handler) : Effect.void)),
        Effect.repeat(Schedule.spaced("250 millis")),
        Effect.catchCause((cause) => Effect.logWarning("heap snapshot event listener failed", { cause })),
        Effect.forkScoped({ startImmediately: true }),
      )
    }).pipe(Effect.catchCause((cause) => Effect.logWarning("heap snapshot event listener failed", { cause })))
  }
  if (process.platform !== "win32") {
    yield* Effect.acquireRelease(
      Effect.sync(() => process.on("SIGUSR1", handler)),
      () => Effect.sync(() => process.off("SIGUSR1", handler)),
    )
  }
  yield* Queue.take(signals).pipe(
    Effect.andThen(
      Effect.suspend(() => {
        const file = path.join(
          global.log,
          `heap-${process.pid}-${new Date().toISOString().replace(/[:.]/g, "")}.heapsnapshot`,
        )
        return Effect.gen(function* () {
          yield* Effect.logInfo("writing heap snapshot", { path: file })
          const { writeHeapSnapshot } = yield* Effect.tryPromise(() => import("node:v8"))
          yield* Effect.try(() => writeHeapSnapshot(file))
          yield* Effect.logInfo("heap snapshot written", { path: file })
        }).pipe(Effect.catchCause((cause) => Effect.logError("failed to write heap snapshot", { path: file, cause })))
      }),
    ),
    Effect.forever,
    Effect.forkScoped({ startImmediately: true }),
  )
})

export * as Heap from "./heap"
