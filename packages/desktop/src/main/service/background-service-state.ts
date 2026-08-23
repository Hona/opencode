export * as BackgroundServiceState from "./background-service-state"

import { Effect, Exit, Ref } from "effect"
import type { ServerReadyData } from "../../shared/ipc-contract"

export const make = Effect.fn("BackgroundServiceState.make")(function* (options: {
  readonly initial: Effect.Effect<ServerReadyData, unknown>
  readonly reconnect: Effect.Effect<ServerReadyData>
}) {
  const result = yield* options.initial.pipe(Effect.exit)
  const current = yield* Ref.make(
    Exit.isSuccess(result) ? Effect.succeed(result.value) : Effect.failCause(result.cause).pipe(Effect.orDie),
  )
  const reconnect = options.reconnect.pipe(Effect.tap((next) => Ref.set(current, Effect.succeed(next))))
  return {
    connection: Ref.get(current).pipe(Effect.flatten),
    reconnect,
  }
})
