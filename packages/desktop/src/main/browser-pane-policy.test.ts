import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import {
  allowedBrowserURL,
  boundedBrowserOperation,
  browserBottomMasks,
  browserContextPartition,
  browserContextEvictions,
  browserContextLimit,
  browserDestinationOrigin,
  browserSnapshotExpression,
  browserSnapshotLimit,
  invalidateBrowserRefs,
  normalizeBrowserBounds,
  normalizeBrowserRef,
  normalizeBrowserURL,
  ownBrowserParentListeners,
  runBrowserInputPair,
  allowedBrowserDestination,
  privateBrowserOrigin,
  stopBrowserOperation,
} from "./browser-pane-policy"

async function rejected(promise: Promise<unknown>) {
  return promise.then(
    () => new Error("Expected operation to reject"),
    (error) => (error instanceof Error ? error : new Error(String(error))),
  )
}

describe("browser pane policy", () => {
  test("normalizes supported browser URLs", () => {
    expect(normalizeBrowserURL("localhost:3000/test")).toBe("http://localhost:3000/test")
    expect(normalizeBrowserURL("example.com")).toBe("https://example.com/")
    expect(normalizeBrowserURL("https://example.com/path")).toBe("https://example.com/path")
    expect(normalizeBrowserURL("file:///tmp/clicker/index.html")).toBe("file:///tmp/clicker/index.html")
  })

  test("rejects unsafe browser URLs", () => {
    expect(() => normalizeBrowserURL("javascript:alert(1)")).toThrow()
    expect(() => normalizeBrowserURL("https://user:pass@example.com")).toThrow()
    expect(allowedBrowserURL("data:text/html,test")).toBe(false)
    expect(allowedBrowserURL("file:///tmp/clicker/index.html")).toBe(true)
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

  test("accepts browser refs with or without the display prefix", () => {
    expect(normalizeBrowserRef("e2")).toBe("@e2")
    expect(normalizeBrowserRef("@e2")).toBe("@e2")
  })

  test("invalidates refs when attachment ownership changes", () => {
    const state = { snapshot: 4, refs: new Map([["@e1", 1]]) }
    invalidateBrowserRefs(state)
    expect(state.snapshot).toBe(5)
    expect(state.refs.size).toBe(0)
  })

  test("isolates Session contexts while preserving same-Session identity", () => {
    expect(browserContextPartition(1, "ses_a")).toBe(browserContextPartition(1, "ses_a"))
    expect(browserContextPartition(1, "ses_a")).not.toBe(browserContextPartition(1, "ses_b"))
    expect(browserContextPartition(1, "ses_a")).not.toBe(browserContextPartition(2, "ses_a"))
  })

  test("evicts oldest idle contexts without evicting attached contexts", () => {
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

  test("LRU disposal removes parent listeners and makes captured callbacks inert", () => {
    const parent = new EventEmitter()
    const closed = new Set<string>()
    const touched: string[] = []
    const contexts = [
      { id: "active", attached: true, lastUsed: 0 },
      ...Array.from({ length: browserContextLimit }, (_, index) => ({
        id: `idle-${index}`,
        attached: false,
        lastUsed: index + 1,
      })),
    ].map((context) => ({
      ...context,
      listeners: ownBrowserParentListeners({
        addNavigation: (listener) => parent.on("navigation", listener),
        removeNavigation: (listener) => parent.removeListener("navigation", listener),
        addCrash: (listener) => parent.on("crash", listener),
        removeCrash: (listener) => parent.removeListener("crash", listener),
        detach: () => {
          if (closed.has(context.id)) throw new Error(`Touched closed context: ${context.id}`)
          touched.push(context.id)
        },
      }),
    }))
    const evicted = browserContextEvictions(contexts)
    const stale = contexts.find((context) => context.id === evicted[0])?.listeners

    for (const id of evicted) {
      const context = contexts.find((context) => context.id === id)
      context?.listeners.dispose()
      context?.listeners.dispose()
      closed.add(id)
    }

    expect(parent.listenerCount("navigation")).toBe(browserContextLimit)
    expect(parent.listenerCount("crash")).toBe(browserContextLimit)
    expect(() => stale?.didStartNavigation()).not.toThrow()
    expect(() => stale?.renderProcessGone()).not.toThrow()
    parent.emit("navigation")
    parent.emit("crash")
    expect(touched).toHaveLength(browserContextLimit * 2)
    expect(touched.includes("idle-0")).toBe(false)
  })

  test("caps semantic traversal in the page producer", () => {
    const expression = browserSnapshotExpression(41)
    expect(expression).toContain(`while (visited++ < ${browserSnapshotLimit})`)
    expect(expression).toContain("let ref = 41")
    expect(expression).toContain('"e" + (++ref)')
    expect(expression).toContain('editable ? ""')
    expect(expression).not.toContain("textContent")
    expect(expression).not.toContain("getFullAXTree")
    expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(expression)).not.toThrow()
  })

  test("requires an explicit origin for private destinations", () => {
    expect(privateBrowserOrigin("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000")
    expect(allowedBrowserDestination("http://127.0.0.1:3000/path")).toBe(false)
    expect(allowedBrowserDestination("http://127.0.0.1:3000/path", "http://127.0.0.1:3000")).toBe(true)
    expect(allowedBrowserDestination("http://169.254.169.254/latest")).toBe(false)
    expect(allowedBrowserDestination("file:///tmp/secret.txt")).toBe(false)
    expect(allowedBrowserDestination("file:///tmp/secret.txt", "file:")).toBe(true)
    expect(allowedBrowserDestination("https://example.com/redirect")).toBe(false)
    expect(allowedBrowserDestination("https://example.com/redirect", "https://example.com")).toBe(true)
    expect(browserDestinationOrigin("https://example.com/path")).toBe("https://example.com")
    expect(allowedBrowserDestination("https://other.example/redirect", "https://example.com")).toBe(false)
  })

  test("stops and aborts the active operation immediately", () => {
    const active = new AbortController()
    let stopped = false
    stopBrowserOperation({
      active,
      stop: () => {
        stopped = true
      },
    })
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
  })

  test("releases paired input when cancellation races after press", async () => {
    const controller = new AbortController()
    const events: string[] = []
    const assert = () => {
      if (controller.signal.aborted) throw new Error("aborted")
    }
    const result = runBrowserInputPair({
      assert,
      press: async () => {
        events.push("press")
        controller.abort()
        throw new Error("aborted")
      },
      release: async () => {
        events.push("release")
      },
    })
    expect((await rejected(result)).message).toBe("aborted")
    expect(events).toEqual(["press", "release"])
  })

  test("does not dispatch paired input when already cancelled", async () => {
    const events: string[] = []
    const result = runBrowserInputPair({
      assert: () => {
        throw new Error("aborted")
      },
      press: async () => {
        events.push("press")
      },
      release: async () => {
        events.push("release")
      },
    })
    expect((await rejected(result)).message).toBe("aborted")
    expect(events).toEqual([])
  })
})
