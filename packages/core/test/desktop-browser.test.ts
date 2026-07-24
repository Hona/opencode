import { describe, expect, test } from "bun:test"
import { DesktopBrowser } from "../src/desktop-browser"

describe("desktop browser contract", () => {
  test("accepts typed requests and responses", () => {
    const request: DesktopBrowser.Request = {
      type: "desktop.browser.request",
      version: DesktopBrowser.VERSION,
      requestID: "request",
      sessionID: "session",
      command: { type: "navigate", url: "http://localhost:3000" },
    }
    const response: DesktopBrowser.Response = {
      type: "desktop.browser.response",
      version: DesktopBrowser.VERSION,
      requestID: "request",
      result: {
        type: "status",
        attached: true,
        state: {
          url: "http://localhost:3000",
          title: "App",
          loading: false,
          canGoBack: false,
          canGoForward: false,
          generation: 1,
        },
      },
    }

    expect(DesktopBrowser.isRequest(request)).toBe(true)
    expect(DesktopBrowser.isResponse(response)).toBe(true)
  })

  test("rejects malformed bridge messages", () => {
    expect(DesktopBrowser.isRequest({ type: "desktop.browser.request", version: 2 })).toBe(false)
    expect(
      DesktopBrowser.isRequest({
        type: "desktop.browser.request",
        version: DesktopBrowser.VERSION,
        requestID: "request",
        sessionID: "session",
        command: { type: "press", key: "LaunchMissiles", generation: 1 },
      }),
    ).toBe(false)
    expect(
      DesktopBrowser.isResponse({
        type: "desktop.browser.response",
        version: DesktopBrowser.VERSION,
        requestID: "request",
        result: { type: "screenshot", data: 42 },
      }),
    ).toBe(false)
    expect(
      DesktopBrowser.isResponse({
        type: "desktop.browser.response",
        version: DesktopBrowser.VERSION,
        requestID: "request",
        result: { type: "status", attached: false },
        error: { code: "internal", message: "bad", retryable: false },
      }),
    ).toBe(false)
  })
})
