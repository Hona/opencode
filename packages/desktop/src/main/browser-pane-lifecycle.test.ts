import { describe, expect, test } from "bun:test"
import {
  createBrowserPaneLifecycle,
  fenceBrowserPaneOperation,
  startBrowserPaneOperation,
  SupersededError,
} from "./browser-pane-lifecycle"

type Context = { id: number; closed: boolean; touches: string[] }

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup() {
  const ready: ReturnType<typeof deferred>[] = []
  const contexts: Context[] = []
  const closed: number[] = []
  let lease = 0
  const lifecycle = createBrowserPaneLifecycle({
    create: () => {
      const context = { id: contexts.length + 1, closed: false, touches: [] }
      const next = deferred()
      contexts.push(context)
      ready.push(next)
      return { context, ready: next.promise }
    },
    close: (context) => {
      context.closed = true
      closed.push(context.id)
    },
    lease: () => `lease-${++lease}`,
  })
  return { lifecycle, ready, contexts, closed }
}

describe("browser pane lifecycle", () => {
  test("replaces the context before Session B can receive a lease", async () => {
    const app = setup()
    const first = app.lifecycle.claim("session-a")
    app.ready[0].resolve()
    const sessionA = await first

    const delayed = () => {
      if (!sessionA.context.closed) sessionA.context.touches.push("delayed-a")
    }
    const second = app.lifecycle.claim("session-b")
    expect(sessionA.context.closed).toBe(true)
    delayed()
    expect(app.contexts[1].touches).toEqual([])
    expect(app.lifecycle.current()).toBeUndefined()

    app.ready[1].resolve()
    const sessionB = await second
    expect(sessionB.context).not.toBe(sessionA.context)
    expect(sessionB.lease).not.toBe(sessionA.lease)
    expect(app.lifecycle.isCurrent(sessionA)).toBe(false)
    expect(app.lifecycle.isCurrent(sessionB)).toBe(true)
  })

  test("reuses an attached context only for the same Session", async () => {
    const app = setup()
    const first = app.lifecycle.claim("session-a")
    app.ready[0].resolve()
    const sessionA = await first

    expect(await app.lifecycle.claim("session-a")).toBe(sessionA)
    expect(app.contexts).toHaveLength(1)
    expect(app.closed).toEqual([])
  })

  test("keeps a successful started operation on the same Session context", async () => {
    const app = setup()
    const first = app.lifecycle.claim("session-a")
    app.ready[0].resolve()
    const sessionA = await first
    const operation = { started: false }

    expect(
      await fenceBrowserPaneOperation({
        operation,
        context: sessionA.context,
        run: () => Promise.resolve(startBrowserPaneOperation(operation, () => Promise.resolve("ok"))),
        replace: () => {
          throw new Error("successful operation replaced its context")
        },
      }),
    ).toBe("ok")
    expect(operation.started).toBe(true)
    expect(app.lifecycle.current()).toBe(sessionA)
    expect(sessionA.context.closed).toBe(false)
  })

  test("fails a pending claim on crash and retries with a clean context", async () => {
    const app = setup()
    const first = app.lifecycle.claim("session-a")
    const crashed = app.lifecycle.state()?.context
    expect(crashed).toBe(app.contexts[0])
    if (!crashed) throw new Error("pending browser context missing")
    expect(app.lifecycle.crash(crashed)).toBe("session-a")
    expect(crashed.closed).toBe(true)

    const retry = app.lifecycle.claim("session-a")
    app.ready[0].reject(new Error("renderer gone"))
    await expect(first).rejects.toBeInstanceOf(SupersededError)
    app.ready[1].resolve()
    const recovered = await retry

    expect(recovered.context).toBe(app.contexts[1])
    expect(recovered.context.closed).toBe(false)
    expect(app.lifecycle.current()).toBe(recovered)
  })

  test("closes stale contexts idempotently", async () => {
    const app = setup()
    const first = app.lifecycle.claim("session-a")
    app.ready[0].resolve()
    const sessionA = await first

    expect(app.lifecycle.release("session-a")).toBe(true)
    expect(app.lifecycle.release("session-a")).toBe(false)
    expect(app.lifecycle.crash(sessionA.context)).toBeUndefined()
    app.lifecycle.dispose()
    expect(app.closed).toEqual([1])
  })

  test("closes an aborted started context before replacement work advances", async () => {
    const app = setup()
    const first = app.lifecycle.claim("session-a")
    app.ready[0].resolve()
    const sessionA = await first
    const native = deferred()
    const aborted = deferred()
    const operation = { started: false }
    let replacement: Promise<typeof sessionA> | undefined

    const result = fenceBrowserPaneOperation({
      operation,
      context: sessionA.context,
      run: () =>
        Promise.race([
          startBrowserPaneOperation(operation, () =>
            native.promise.then(() => {
              sessionA.context.touches.push("late-a")
            }),
          ),
          aborted.promise.then(() => Promise.reject(Object.assign(new Error("aborted"), { code: "aborted" }))),
        ]),
      replace: (context) => {
        const sessionID = app.lifecycle.crash(context)
        if (sessionID) replacement = app.lifecycle.claim(sessionID)
      },
    })

    aborted.resolve()
    await expect(result).rejects.toThrow("aborted")
    expect(sessionA.context.closed).toBe(true)
    expect(replacement).toBeDefined()
    app.ready[1].resolve()
    if (!replacement) throw new Error("replacement browser claim missing")
    const sessionB = await replacement
    native.resolve()
    await native.promise
    await Promise.resolve()

    expect(sessionB.context).not.toBe(sessionA.context)
    expect(sessionB.lease).not.toBe(sessionA.lease)
    expect(sessionB.context.touches).toEqual([])
    expect(sessionA.context.touches).toEqual(["late-a"])
  })

  test("closes a timed-out started context", async () => {
    const app = setup()
    const first = app.lifecycle.claim("session-a")
    app.ready[0].resolve()
    const sessionA = await first
    const operation = { started: false }

    await expect(
      fenceBrowserPaneOperation({
        operation,
        context: sessionA.context,
        run: () =>
          Promise.resolve(
            startBrowserPaneOperation(operation, () =>
              Promise.reject(Object.assign(new Error("timed out"), { code: "timeout" })),
            ),
          ),
        replace: (context) => {
          app.lifecycle.crash(context)
        },
      }),
    ).rejects.toThrow("timed out")
    expect(sessionA.context.closed).toBe(true)
    expect(app.lifecycle.current()).toBeUndefined()
  })
})
