import { describe, expect } from "bun:test"
import { DesktopBrowser } from "@opencode-ai/core/desktop-browser"
import { DesktopBrowserHost } from "@/desktop/browser"
import { Effect } from "effect"
import { it } from "./lib/effect"

const state: DesktopBrowser.State = {
  url: "https://example.com/",
  title: "Example",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 3,
}

describe("DesktopBrowserHost", () => {
  it.effect("resolves pushed attachment state without a status roundtrip", () =>
    Effect.gen(function* () {
      const listeners: ((event: { data: unknown }) => void)[] = []
      const sent: (DesktopBrowser.Request | DesktopBrowser.Cancel)[] = []
      const host = DesktopBrowserHost.make({
        on: (_event, listener) => listeners.push(listener),
        postMessage: (message) => sent.push(message),
      })
      listeners.forEach((listener) =>
        listener({
          data: {
            type: "desktop.browser.state",
            version: DesktopBrowser.VERSION,
            attachments: [{ sessionID: "ses_attached", lease: "lease-1", state }],
          } satisfies DesktopBrowser.AttachmentState,
        }),
      )

      expect(host.attached("ses_attached")).toBe(true)
      expect(host.attached("ses_detached")).toBe(false)
      expect(host.lease("ses_attached")).toMatchObject({ id: "lease-1", state })
      expect(sent).toEqual([])
    }),
  )

  it.effect("keeps an old provider definition fenced to its captured lease", () =>
    Effect.gen(function* () {
      const listeners: ((event: { data: unknown }) => void)[] = []
      const sent: (DesktopBrowser.Request | DesktopBrowser.Cancel)[] = []
      const host = DesktopBrowserHost.make({
        on: (_event, listener) => listeners.push(listener),
        postMessage: (message) => {
          sent.push(message)
          if (message.type !== "desktop.browser.request") return
          listeners.forEach((listener) =>
            listener({
              data: {
                type: "desktop.browser.response",
                version: DesktopBrowser.VERSION,
                requestID: message.requestID,
                result: { type: "status", attached: false },
              } satisfies DesktopBrowser.Response,
            }),
          )
        },
      })
      const publish = (lease: string) =>
        listeners.forEach((listener) =>
          listener({
            data: {
              type: "desktop.browser.state",
              version: DesktopBrowser.VERSION,
              attachments: [{ sessionID: "ses_attached", lease, state }],
            } satisfies DesktopBrowser.AttachmentState,
          }),
        )
      publish("lease-1")
      const old = host.lease("ses_attached")
      publish("lease-2")

      expect(yield* old!.request({ type: "status" })).toEqual({ type: "status", attached: false })
      expect(sent.at(-1)).toMatchObject({ type: "desktop.browser.request", lease: "lease-1" })
      expect(host.lease("ses_attached")?.id).toBe("lease-2")
    }),
  )
})
