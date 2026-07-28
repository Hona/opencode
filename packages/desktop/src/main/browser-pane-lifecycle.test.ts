import { describe, expect, test } from "bun:test"
import {
  BrowserPaneSupersededError,
  createBrowserPaneLifecycle,
  fenceBrowserPaneOperation,
  sameBrowserPaneIdentity,
  sameBrowserPaneSession,
  startBrowserPaneOperation,
  type BrowserPaneIdentity,
} from "./browser-pane-lifecycle"

type Context = { readonly id: number; closed: boolean; readonly touches: string[] }

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function rejected(promise: Promise<unknown>) {
  return promise.then(
    () => new Error("Expected operation to reject"),
    (error) => (error instanceof Error ? error : new Error(String(error))),
  )
}

function identity(serverKey: string, sessionID: string, bindingID: string, endpointRevision = 0): BrowserPaneIdentity {
  return { serverKey, sessionID, bindingID, endpointRevision }
}

function setup(limit?: number) {
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
    limit,
  })
  return { lifecycle, ready, contexts, closed }
}

describe("browser pane lifecycle", () => {
  test("distinguishes server-scoped Sessions from exact bindings", () => {
    const first = identity("server-a", "session-a", "binding-a")
    expect(sameBrowserPaneSession(first, identity("server-a", "session-a", "binding-b"))).toBe(true)
    expect(sameBrowserPaneIdentity(first, identity("server-a", "session-a", "binding-b"))).toBe(false)
    expect(sameBrowserPaneSession(first, identity("server-b", "session-a", "binding-a"))).toBe(false)
  })

  test("reuses a context only for the exact server, Session, and binding", async () => {
    const app = setup()
    const owner = identity("server-a", "session-a", "binding-a")
    const first = app.lifecycle.claim(owner)
    app.ready[0].resolve()
    const claim = await first

    expect(await app.lifecycle.claim({ ...owner })).toBe(claim)
    expect(app.lifecycle.isCurrent({ ...claim })).toBe(false)
    expect(app.contexts).toHaveLength(1)
    expect(app.closed).toEqual([])
  })

  test("retains an idle server Session context and reuses it with a new lease", async () => {
    const app = setup()
    const sessionA = identity("server-a", "session-a", "binding-a")
    const first = app.lifecycle.claim(sessionA)
    app.ready[0].resolve()
    const claimA = await first

    const second = app.lifecycle.claim(identity("server-a", "session-b", "binding-b"))
    expect(claimA.context.closed).toBe(false)
    app.ready[1].resolve()
    await second

    const resumed = await app.lifecycle.claim(sessionA)
    expect(resumed.context).toBe(claimA.context)
    expect(resumed.leaseID).not.toBe(claimA.leaseID)
    expect(app.contexts).toHaveLength(2)
  })

  test("rebinds the same endpoint context without crossing servers", async () => {
    const app = setup()
    const first = app.lifecycle.claim(identity("server-a", "session-a", "binding-a"))
    app.ready[0].resolve()
    const claimA = await first

    const rebound = app.lifecycle.claim(identity("server-a", "session-a", "binding-b"))
    const claimB = await rebound
    expect(claimB.context).toBe(claimA.context)
    expect(claimA.context.closed).toBe(false)
    expect(claimB.leaseID).not.toBe(claimA.leaseID)

    const moved = app.lifecycle.claim(identity("server-b", "session-a", "binding-b"))
    expect(claimB.context.closed).toBe(false)
    app.ready[1].resolve()
    const claimC = await moved
    expect(claimC.context).not.toBe(claimB.context)
    expect(app.lifecycle.isCurrent(claimA)).toBe(false)
    expect(app.lifecycle.isCurrent(claimB)).toBe(false)
    expect(app.lifecycle.isCurrent(claimC)).toBe(true)

    const resumed = await app.lifecycle.claim(identity("server-a", "session-a", "binding-b"))
    expect(resumed.context).toBe(claimB.context)
    expect(claimC.context.closed).toBe(false)
  })

  test("does not let a stale binding release the current claim", async () => {
    const app = setup()
    const old = identity("server-a", "session-a", "binding-a")
    const pending = app.lifecycle.claim(identity("server-a", "session-a", "binding-b"))
    app.ready[0].resolve()
    const current = await pending

    expect(app.lifecycle.release(old)).toBe(false)
    expect(app.lifecycle.current()).toBe(current)
    expect(current.context.closed).toBe(false)
  })

  test("supersedes a pending claim before issuing its lease", async () => {
    const app = setup()
    const first = app.lifecycle.claim(identity("server-a", "session-a", "binding-a"))
    const second = app.lifecycle.claim(identity("server-a", "session-b", "binding-b"))
    expect(app.contexts[0].closed).toBe(true)

    app.ready[0].resolve()
    expect(await rejected(first)).toBeInstanceOf(BrowserPaneSupersededError)
    app.ready[1].resolve()
    expect((await second).leaseID).toBe("lease-1")
  })

  test("fails a pending claim on crash and retries with a clean context", async () => {
    const app = setup()
    const owner = identity("server-a", "session-a", "binding-a")
    const first = app.lifecycle.claim(owner)
    const crashed = app.lifecycle.state()?.context
    if (!crashed) throw new Error("pending browser context missing")
    expect(app.lifecycle.crash(crashed)).toEqual(owner)
    expect(crashed.closed).toBe(true)

    const retry = app.lifecycle.claim(owner)
    app.ready[0].reject(new Error("renderer gone"))
    expect(await rejected(first)).toBeInstanceOf(BrowserPaneSupersededError)
    app.ready[1].resolve()
    const recovered = await retry
    expect(recovered.context).toBe(app.contexts[1])
    expect(app.lifecycle.current()).toBe(recovered)
  })

  test("retains released contexts and closes an idle crash idempotently", async () => {
    const app = setup()
    const owner = identity("server-a", "session-a", "binding-a")
    const first = app.lifecycle.claim(owner)
    app.ready[0].resolve()
    const claim = await first

    expect(app.lifecycle.release(owner)).toBe(true)
    expect(claim.context.closed).toBe(false)
    expect(app.lifecycle.release(owner)).toBe(false)
    expect(app.lifecycle.crash(claim.context)).toEqual(owner)
    expect(app.lifecycle.crash(claim.context)).toBeUndefined()
    app.lifecycle.dispose()
    expect(app.closed).toEqual([1])
  })

  test("issues a new lease when the same binding is released and reclaimed", async () => {
    const app = setup()
    const owner = identity("server-a", "session-a", "binding-a")
    const first = app.lifecycle.claim(owner)
    app.ready[0].resolve()
    const old = await first
    app.lifecycle.release(owner)

    const second = app.lifecycle.claim(owner)
    const current = await second
    expect(current.context).toBe(old.context)
    expect(current.context.closed).toBe(false)
    expect(current.leaseID).not.toBe(old.leaseID)
    expect(app.lifecycle.isCurrent(old)).toBe(false)
    expect(app.lifecycle.isCurrent(current)).toBe(true)
  })

  test("replaces an idle network context when the endpoint revision changes", async () => {
    const app = setup()
    const first = app.lifecycle.claim(identity("server-a", "session-a", "binding-a"))
    app.ready[0].resolve()
    const old = await first
    app.lifecycle.release(old)

    const replacement = app.lifecycle.claim(identity("server-a", "session-a", "binding-b", 1))
    expect(old.context.closed).toBe(true)
    app.ready[1].resolve()
    const current = await replacement
    expect(current.context).not.toBe(old.context)
    expect(app.closed).toEqual([1])
  })

  test("evicts the least-recently-used idle context at the per-window limit", async () => {
    const app = setup(4)
    const claims = []
    for (let index = 0; index < 4; index++) {
      const pending = app.lifecycle.claim(identity("server-a", `session-${index}`, `binding-${index}`))
      app.ready[index].resolve()
      claims.push(await pending)
    }

    const recent = await app.lifecycle.claim(identity("server-a", "session-0", "binding-0"))
    expect(recent.context).toBe(claims[0].context)
    const fifth = app.lifecycle.claim(identity("server-a", "session-4", "binding-4"))
    app.ready[4].resolve()
    claims.push(await fifth)

    expect(claims[0].context.closed).toBe(false)
    expect(claims[1].context.closed).toBe(true)
    expect(claims.slice(2).every((claim) => !claim.context.closed)).toBe(true)
    expect(app.closed).toEqual([2])

    const resumed = await app.lifecycle.claim(identity("server-a", "session-2", "binding-2"))
    expect(resumed.context).toBe(claims[2].context)
    expect(app.contexts).toHaveLength(5)
  })

  test("disposes every retained context and its cleanup exactly once", async () => {
    const app = setup()
    const first = app.lifecycle.claim(identity("server-a", "session-a", "binding-a"))
    app.ready[0].resolve()
    await first
    const second = app.lifecycle.claim(identity("server-a", "session-b", "binding-b"))
    app.ready[1].resolve()
    await second

    app.lifecycle.dispose()
    app.lifecycle.dispose()
    expect(app.closed).toEqual([1, 2])
  })

  test("keeps successful started operations on the current lease", async () => {
    const app = setup()
    const first = app.lifecycle.claim(identity("server-a", "session-a", "binding-a"))
    app.ready[0].resolve()
    const claim = await first
    const operation = { started: false }

    expect(
      await fenceBrowserPaneOperation({
        operation,
        context: claim.context,
        run: () => Promise.resolve(startBrowserPaneOperation(operation, () => Promise.resolve("ok"))),
        replace: () => {
          throw new Error("successful operation replaced its context")
        },
      }),
    ).toBe("ok")
    expect(operation.started).toBe(true)
    expect(app.lifecycle.current()).toBe(claim)
  })

  test("closes an interrupted started context before replacement advances", async () => {
    const app = setup()
    const owner = identity("server-a", "session-a", "binding-a")
    const first = app.lifecycle.claim(owner)
    app.ready[0].resolve()
    const claim = await first
    const native = deferred()
    const aborted = deferred()
    const operation = { started: false }
    let replacement: ReturnType<typeof app.lifecycle.claim> | undefined

    const result = fenceBrowserPaneOperation({
      operation,
      context: claim.context,
      run: () =>
        Promise.race([
          startBrowserPaneOperation(operation, () =>
            native.promise.then(() => {
              claim.context.touches.push("late-old-context")
            }),
          ),
          aborted.promise.then(() => Promise.reject(Object.assign(new Error("aborted"), { code: "aborted" }))),
        ]),
      replace: (context) => {
        const crashed = app.lifecycle.crash(context)
        if (crashed) replacement = app.lifecycle.claim(crashed)
      },
    })

    aborted.resolve()
    expect((await rejected(result)).message).toBe("aborted")
    expect(claim.context.closed).toBe(true)
    if (!replacement) throw new Error("replacement browser claim missing")
    app.ready[1].resolve()
    const next = await replacement
    native.resolve()
    await native.promise
    await Promise.resolve()

    expect(next.context).not.toBe(claim.context)
    expect(next.leaseID).not.toBe(claim.leaseID)
    expect(next.context.touches).toEqual([])
    expect(claim.context.touches).toEqual(["late-old-context"])
  })

  test("replaces a started context after timeout", async () => {
    const app = setup()
    const first = app.lifecycle.claim(identity("server-a", "session-a", "binding-a"))
    app.ready[0].resolve()
    const claim = await first
    const operation = { started: false }

    expect(
      (
        await rejected(
          fenceBrowserPaneOperation({
            operation,
            context: claim.context,
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
        )
      ).message,
    ).toBe("timed out")
    expect(claim.context.closed).toBe(true)
    expect(app.lifecycle.current()).toBeUndefined()
  })
})
