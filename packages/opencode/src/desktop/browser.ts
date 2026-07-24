import { DesktopBrowser } from "@opencode-ai/core/desktop-browser"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer, Schema } from "effect"

type ParentPort = {
  postMessage(message: DesktopBrowser.Request | DesktopBrowser.Cancel): void
  on(event: "message", listener: (event: { data: unknown }) => void): void
}

type UtilityProcess = NodeJS.Process & { parentPort?: ParentPort }

export class RequestError extends Schema.TaggedErrorClass<RequestError>()("DesktopBrowserRequestError", {
  code: Schema.String,
  message: Schema.String,
  retryable: Schema.Boolean,
}) {}

export interface Interface {
  readonly enabled: boolean
  readonly attached: (sessionID: string) => Effect.Effect<boolean>
  readonly request: (
    sessionID: string,
    command: DesktopBrowser.Command,
    abort?: AbortSignal,
  ) => Effect.Effect<DesktopBrowser.Result, RequestError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesktopBrowser") {}

const layer = Layer.sync(Service, () => {
  const parent = (process as UtilityProcess).parentPort
  if (!parent) {
    return Service.of({
      enabled: false,
      attached: () => Effect.succeed(false),
      request: () =>
        new RequestError({ code: "not_attached", message: "The desktop browser is unavailable.", retryable: true }),
    })
  }

  const pending = new Map<
    string,
    {
      resolve(response: DesktopBrowser.Response): void
      reject(error: RequestError): void
    }
  >()
  const onMessage = (event: { data: unknown }) => {
    if (!DesktopBrowser.isResponse(event.data)) return
    const match = pending.get(event.data.requestID)
    if (!match) return
    pending.delete(event.data.requestID)
    match.resolve(event.data)
  }
  parent.on("message", onMessage)

  const request: Interface["request"] = Effect.fn("DesktopBrowser.request")((sessionID, command, abort) =>
    Effect.callback<DesktopBrowser.Result, RequestError>((resume) => {
      const requestID = crypto.randomUUID()
      const timeout = command.type === "status" ? 300 : command.type === "navigate" ? 30_000 : 15_000
      const cleanup = () => {
        clearTimeout(timer)
        abort?.removeEventListener("abort", onAbort)
        pending.delete(requestID)
      }
      const cancel = () => {
        parent.postMessage({ type: "desktop.browser.cancel", version: DesktopBrowser.VERSION, requestID })
      }
      const fail = (error: RequestError, cancelRequest = false) => {
        if (cancelRequest) cancel()
        cleanup()
        resume(Effect.fail(error))
      }
      const onAbort = () => {
        fail(new RequestError({ code: "aborted", message: "The browser action was aborted.", retryable: true }), true)
      }
      const timer = setTimeout(
        () =>
          fail(new RequestError({ code: "timeout", message: "The browser action timed out.", retryable: true }), true),
        timeout,
      )

      pending.set(requestID, {
        resolve: (response) => {
          cleanup()
          if (response.error) {
            resume(Effect.fail(new RequestError(response.error)))
            return
          }
          if (response.result) {
            resume(Effect.succeed(response.result))
            return
          }
          resume(
            Effect.fail(
              new RequestError({
                code: "protocol",
                message: "The desktop browser returned an empty response.",
                retryable: false,
              }),
            ),
          )
        },
        reject: fail,
      })
      abort?.addEventListener("abort", onAbort, { once: true })
      if (abort?.aborted) onAbort()
      if (!abort?.aborted) {
        parent.postMessage({
          type: "desktop.browser.request",
          version: DesktopBrowser.VERSION,
          requestID,
          sessionID,
          command,
        })
      }
      return Effect.sync(() => {
        if (!pending.has(requestID)) return
        cancel()
        cleanup()
      })
    }),
  )

  return Service.of({
    enabled: true,
    attached: (sessionID) =>
      request(sessionID, { type: "status" }).pipe(
        Effect.map((result) => result.type === "status" && result.attached),
        Effect.catch(() => Effect.succeed(false)),
      ),
    request,
  })
})

export const node = LayerNode.make({ service: Service, layer, deps: [] })

export * as DesktopBrowserHost from "./browser"
