import { describe, expect, test } from "bun:test"
import { DesktopBrowser } from "../src/desktop-browser"
import { ConfigPermissionV1 } from "../src/v1/config/permission"
import { Schema } from "effect"

describe("desktop browser contract", () => {
  test("accepts leased requests, pushed attachment state, and responses", () => {
    const request: DesktopBrowser.Request = {
      type: "desktop.browser.request",
      version: DesktopBrowser.VERSION,
      requestID: "request",
      sessionID: "session",
      lease: "lease",
      command: { type: "navigate", url: "http://localhost:3000", generation: 1 },
    }
    const attachment: DesktopBrowser.AttachmentState = {
      type: "desktop.browser.state",
      version: DesktopBrowser.VERSION,
      attachments: [{ sessionID: "session", lease: "lease", state: page }],
    }
    const response: DesktopBrowser.Response = {
      type: "desktop.browser.response",
      version: DesktopBrowser.VERSION,
      requestID: "request",
      result: {
        type: "status",
        attached: true,
        lease: "lease",
        state: page,
      },
    }

    expect(DesktopBrowser.isRequest(request)).toBe(true)
    expect(DesktopBrowser.isAttachmentState(attachment)).toBe(true)
    expect(DesktopBrowser.isResponse(response)).toBe(true)
  })

  test("requires leases and captured generations for actions", () => {
    const request = {
      type: "desktop.browser.request",
      version: DesktopBrowser.VERSION,
      requestID: "request",
      sessionID: "session",
    }
    expect(DesktopBrowser.isRequest({ ...request, command: { type: "snapshot", generation: 1 } })).toBe(false)
    expect(
      DesktopBrowser.isRequest({
        ...request,
        lease: "lease",
        command: { type: "navigate", url: "https://example.com" },
      }),
    ).toBe(false)
  })

  test("canonicalizes supported URLs and rejects unsafe URLs", () => {
    expect(DesktopBrowser.normalizeURL("example.com/path")).toBe("https://example.com/path")
    expect(DesktopBrowser.normalizeURL("file:///tmp/a%20b.txt")).toBe("file:///tmp/a%20b.txt")
    expect(() => DesktopBrowser.normalizeURL("javascript:alert(1)")).toThrow()
    expect(() => DesktopBrowser.normalizeURL("https://user:pass@example.com")).toThrow()
  })

  test("accepts explicit browser permission categories in V1 config", () => {
    expect(
      Schema.decodeUnknownSync(ConfigPermissionV1.Info)({
        browser_read: "allow",
        browser_navigate: { "https://example.com/*": "ask" },
        browser_interact: "deny",
      }),
    ).toEqual({
      browser_read: "allow",
      browser_navigate: { "https://example.com/*": "ask" },
      browser_interact: "deny",
    })
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

const page: DesktopBrowser.State = {
  url: "http://localhost:3000",
  title: "App",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 1,
}
