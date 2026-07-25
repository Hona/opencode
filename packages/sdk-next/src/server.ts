import "./plugin-runtime"

import { NodeServices } from "@effect/platform-node"
import { BrowserControl } from "@opencode-ai/core/browser-control"
import { BrowserHost } from "@opencode-ai/core/browser-host"
import { fromEnvironment } from "@opencode-ai/server/options"
import { ServerProcess } from "@opencode-ai/server/process"
import { Effect, Exit, ManagedRuntime, Scope } from "effect"
import { randomUUID } from "node:crypto"
import type { Listen } from "./server-interface"

export const listen: Listen = async (options, browserControl) => {
  const runtime = ManagedRuntime.make(NodeServices.layer)
  const scope = await runtime.runPromise(Scope.make())
  await runtime
    .runPromise(
      ServerProcess.start(
        fromEnvironment(options),
        {
          instanceID: randomUUID(),
          onListen: () => Effect.succeed(Effect.void),
        },
        browserControl ? { replacements: [[BrowserHost.node, BrowserHost.configured(browserControl)]] } : undefined,
      ).pipe(Effect.provideService(Scope.Scope, scope)),
    )
    .catch(async (error) => {
      await runtime
        .runPromise(Scope.close(scope, Exit.fail(error)))
        .finally(() => Effect.runPromise(runtime.disposeEffect))
      throw error
    })
  let stopped = false
  return {
    stop: async () => {
      if (stopped) return
      stopped = true
      await runtime.runPromise(Scope.close(scope, Exit.void)).finally(() => Effect.runPromise(runtime.disposeEffect))
    },
  }
}

export { BrowserControl } from "@opencode-ai/core/browser-control"
export const Server = { listen }
