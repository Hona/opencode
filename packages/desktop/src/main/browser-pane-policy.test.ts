import { describe, expect, test } from "bun:test"
import {
  allowedBrowserDestination,
  allowedBrowserURL,
  boundedBrowserOperation,
  browserBottomMasks,
  browserContextEvictions,
  browserContextLimit,
  browserContextPartition,
  browserDestinationOrigin,
  browserFillFunction,
  browserHistoryDestinationOrigin,
  browserProtocolError,
  browserSnapshotExpression,
  browserSnapshotLimit,
  invalidateBrowserRefs,
  normalizeBrowserBounds,
  normalizeBrowserRef,
  normalizeBrowserURL,
  runBrowserInputPair,
  stopBrowserOperation,
} from "./browser-pane-policy"

async function rejected(promise: Promise<unknown>) {
  return promise.then(
    () => new Error("Expected operation to reject"),
    (error) => (error instanceof Error ? error : new Error(String(error))),
  )
}

describe("browser pane policy", () => {
  test("normalizes only HTTP, HTTPS, and about:blank URLs", () => {
    expect(normalizeBrowserURL("")).toBe("about:blank")
    expect(normalizeBrowserURL("localhost:3000/test")).toBe("http://localhost:3000/test")
    expect(normalizeBrowserURL("example.com")).toBe("https://example.com/")
    expect(normalizeBrowserURL("https://example.com/path")).toBe("https://example.com/path")
  })

  test("rejects credentials and non-browser protocols", () => {
    expect(() => normalizeBrowserURL("javascript:alert(1)")).toThrow()
    expect(() => normalizeBrowserURL("file:///tmp/secret.txt")).toThrow()
    expect(() => normalizeBrowserURL("https://user:pass@example.com")).toThrow()
    expect(() => normalizeBrowserURL(`https://example.com/${"a".repeat(16_384)}`)).toThrow()
    expect(allowedBrowserURL("data:text/html,test")).toBe(false)
    expect(allowedBrowserURL("about:srcdoc")).toBe(false)
    expect(allowedBrowserURL("about:blank")).toBe(true)
  })

  test("allows only the explicitly approved navigation origin", () => {
    expect(browserDestinationOrigin("https://example.com/path")).toBe("https://example.com")
    expect(allowedBrowserDestination("https://example.com/next", "https://example.com")).toBe(true)
    expect(allowedBrowserDestination("https://other.example/", "https://example.com")).toBe(false)
    expect(allowedBrowserDestination("http://example.com/", "https://example.com")).toBe(false)
    expect(allowedBrowserDestination("https://example.com/next")).toBe(false)
    expect(allowedBrowserDestination("about:blank")).toBe(true)
  })

  test("selects the approved origin for back and forward history entries", () => {
    const history = {
      getActiveIndex: () => 1,
      getAllEntries: () => [
        { url: "https://before.example/path" },
        { url: "https://current.example/path" },
        { url: "https://after.example/path" },
      ],
    }
    expect(browserHistoryDestinationOrigin(history, -1)).toBe("https://before.example")
    expect(browserHistoryDestinationOrigin(history, 1)).toBe("https://after.example")
    expect(browserHistoryDestinationOrigin(history, 2)).toBeUndefined()
  })

  test("partitions contexts by server, Session, binding, and context", () => {
    const partition = browserContextPartition("https://server-a", "session-a", "binding-a", "context-a")
    expect(partition.startsWith("persist:")).toBe(false)
    expect(partition).not.toBe(browserContextPartition("https://server-b", "session-a", "binding-a", "context-a"))
    expect(partition).not.toBe(browserContextPartition("https://server-a", "session-b", "binding-a", "context-a"))
    expect(partition).not.toBe(browserContextPartition("https://server-a", "session-a", "binding-b", "context-a"))
  })

  test("evicts the least-recently-used idle contexts without selecting the attachment", () => {
    expect(browserContextLimit).toBe(4)
    const contexts = [
      { id: "active", attached: true, lastUsed: 0 },
      ...Array.from({ length: browserContextLimit }, (_, index) => ({
        id: `idle-${index}`,
        attached: false,
        lastUsed: index + 1,
      })),
    ]
    expect(browserContextEvictions(contexts)).toEqual(["idle-0"])
    expect(browserContextEvictions(contexts).includes("active")).toBe(false)
  })

  test("accepts canonical refs with an optional display prefix", () => {
    expect(normalizeBrowserRef("e2")).toBe("e2")
    expect(normalizeBrowserRef("@e2")).toBe("e2")
    expect(() => normalizeBrowserRef("2e1")).toThrow()
  })

  test("invalidates refs when document or attachment ownership changes", () => {
    const state = { snapshot: 4, refs: new Map([["e1", 1]]) }
    invalidateBrowserRefs(state)
    expect(state.snapshot).toBe(5)
    expect(state.refs.size).toBe(0)
  })

  test("caps and redacts semantic traversal in the page producer", () => {
    const expression = browserSnapshotExpression(41)
    expect(expression).toContain(`while (visited++ < ${browserSnapshotLimit})`)
    expect(expression).toContain("let ref = 41")
    expect(expression).toContain('"e" + (++ref)')
    expect(expression).toContain('editable ? ""')
    expect(expression).toContain('["INPUT","TEXTAREA","SELECT"].includes(element.tagName)')
    expect(expression).toContain('editable ? "" : textFor(element)')
    expect(expression).not.toContain("textContent")
    expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(expression)).not.toThrow()
  })

  test("checks browser fill targets before focusing them", () => {
    expect(browserFillFunction).toContain('element.tagName === "INPUT"')
    expect(browserFillFunction).toContain('element.tagName === "TEXTAREA"')
    expect(browserFillFunction).toContain("element.isContentEditable")
    expect(browserFillFunction).toContain('element.getAttribute("aria-disabled") === "true"')
    expect(browserFillFunction).toContain('element.getAttribute("aria-readonly") === "true"')
    expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(`(${browserFillFunction})`)).not.toThrow()
  })

  test("clamps browser bounds to the parent content view", () => {
    expect(
      normalizeBrowserBounds({ x: 90.4, y: 40.6, width: 50.2, height: 70.8 }, { x: 0, y: 0, width: 120, height: 100 }),
    ).toEqual({ x: 90, y: 41, width: 30, height: 59 })
    expect(
      normalizeBrowserBounds({ x: 10, y: 10, width: 0, height: 20 }, { x: 0, y: 0, width: 100, height: 100 }),
    ).toBeUndefined()
  })

  test("builds bottom-only corner masks", () => {
    expect(browserBottomMasks({ x: 100, y: 50, width: 400, height: 300 })).toEqual([
      { x: 100, y: 348, width: 6, height: 2 },
      { x: 494, y: 348, width: 6, height: 2 },
      { x: 100, y: 346, width: 3, height: 2 },
      { x: 497, y: 346, width: 3, height: 2 },
      { x: 100, y: 344, width: 2, height: 2 },
      { x: 498, y: 344, width: 2, height: 2 },
      { x: 100, y: 340, width: 1, height: 4 },
      { x: 499, y: 340, width: 1, height: 4 },
    ])
  })

  test("stops and aborts the active operation immediately", () => {
    const active = new AbortController()
    let stopped = false
    stopBrowserOperation({ active, stop: () => (stopped = true) })
    expect(active.signal.aborted).toBe(true)
    expect(stopped).toBe(true)
  })

  test("bounds hung operations by timeout and cancellation", async () => {
    expect(
      await boundedBrowserOperation(() => Promise.resolve(undefined), {
        timeout: 1_000,
        aborted: () => new Error("aborted"),
        timedOut: () => new Error("timed out"),
      }),
    ).toBeUndefined()

    const timeout = boundedBrowserOperation(() => new Promise<never>(() => undefined), {
      timeout: 5,
      aborted: () => new Error("aborted"),
      timedOut: () => new Error("timed out"),
    })
    expect((await rejected(timeout)).message).toBe("timed out")

    const controller = new AbortController()
    const cancelled = boundedBrowserOperation(() => new Promise<never>(() => undefined), {
      signal: controller.signal,
      timeout: 1_000,
      aborted: () => new Error("aborted"),
      timedOut: () => new Error("timed out"),
    })
    controller.abort()
    expect((await rejected(cancelled)).message).toBe("aborted")

    let ran = false
    expect(
      (
        await rejected(
          boundedBrowserOperation(
            () => {
              ran = true
              return Promise.resolve()
            },
            {
              signal: controller.signal,
              timeout: 1_000,
              aborted: () => new Error("aborted"),
              timedOut: () => new Error("timed out"),
            },
          ),
        )
      ).message,
    ).toBe("aborted")
    expect(ran).toBe(false)
  })

  test("releases paired input when cancellation races after press", async () => {
    const events: string[] = []
    const result = runBrowserInputPair({
      assert: () => undefined,
      press: async () => {
        events.push("press")
        throw new Error("aborted")
      },
      release: async () => {
        events.push("release")
      },
    })
    expect((await rejected(result)).message).toBe("aborted")
    expect(events).toEqual(["press", "release"])
  })

  test("maps stale CDP object failures to canonical stale refs", () => {
    expect(browserProtocolError(new Error("Could not find object with given id"))).toMatchObject({ code: "stale_ref" })
    expect(browserProtocolError(new Error("Method not found"))).toBeUndefined()
  })
})
