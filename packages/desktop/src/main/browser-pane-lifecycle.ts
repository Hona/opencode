import { browserContextEvictions, browserContextLimit } from "./browser-pane-policy"

export type BrowserPaneIdentity = {
  readonly serverKey: string
  readonly sessionID: string
  readonly bindingID: string
  readonly endpointRevision: number
}

export function sameBrowserPaneSession(left: BrowserPaneIdentity, right: BrowserPaneIdentity) {
  return left.serverKey === right.serverKey && left.sessionID === right.sessionID
}

export function sameBrowserPaneIdentity(left: BrowserPaneIdentity, right: BrowserPaneIdentity) {
  return (
    sameBrowserPaneSession(left, right) &&
    left.bindingID === right.bindingID &&
    left.endpointRevision === right.endpointRevision
  )
}

export class BrowserPaneSupersededError extends Error {
  constructor() {
    super("Browser pane context was superseded")
    this.name = "BrowserPaneSupersededError"
  }
}

export type BrowserPaneClaim<Context, Lease extends string = string> = BrowserPaneIdentity & {
  readonly context: Context
  readonly leaseID: Lease
}

export type BrowserPaneOperation = { started: boolean }

export function startBrowserPaneOperation<Result>(operation: BrowserPaneOperation, run: () => PromiseLike<Result>) {
  operation.started = true
  return run()
}

export async function fenceBrowserPaneOperation<Context extends object, Result>(input: {
  readonly operation: BrowserPaneOperation
  readonly context: Context
  readonly run: () => Promise<Result>
  readonly replace: (context: Context) => void
}) {
  try {
    return await input.run()
  } catch (error) {
    if (input.operation.started && interruptedBrowserPaneOperation(error)) input.replace(input.context)
    throw error
  }
}

function interruptedBrowserPaneOperation(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false
  return error.code === "aborted" || error.code === "timeout"
}

type Slot<Context, Lease extends string> = BrowserPaneIdentity & {
  readonly key: string
  readonly context: Context
  readonly revision: number
  lastUsed: number
  pending?: Promise<BrowserPaneClaim<Context, Lease>>
  claim?: BrowserPaneClaim<Context, Lease>
}

export function createBrowserPaneLifecycle<Context extends object, Lease extends string = string>(input: {
  readonly create: (identity: BrowserPaneIdentity) => {
    readonly context: Context
    readonly ready: PromiseLike<unknown>
  }
  readonly close: (context: Context) => void
  readonly lease: () => Lease
  readonly limit?: number
}) {
  let revision = 0
  let disposed = false
  let active: Slot<Context, Lease> | undefined
  let contextUse = 0
  // The tuple retains page/network state; bindingID is an ownership epoch and cannot retarget that state.
  const contexts = new Map<string, Slot<Context, Lease>>()
  const owners = new WeakMap<Context, Slot<Context, Lease>>()
  const closed = new WeakSet<Context>()

  const close = (context: Context) => {
    if (closed.has(context)) return
    closed.add(context)
    owners.delete(context)
    input.close(context)
  }

  const remove = (slot: Slot<Context, Lease>) => {
    if (contexts.get(slot.key) === slot) contexts.delete(slot.key)
    if (active === slot) active = undefined
    slot.claim = undefined
    close(slot.context)
  }

  const prune = () => {
    const evictions = browserContextEvictions(
      [...contexts.values()].map((slot) => ({
        id: slot.key,
        attached: slot === active,
        lastUsed: slot.lastUsed,
      })),
      input.limit ?? browserContextLimit,
    )
    evictions.forEach((key) => {
      const slot = contexts.get(key)
      if (slot && slot !== active) remove(slot)
    })
  }

  const release = (identity?: BrowserPaneIdentity) => {
    if (!active || (identity && !sameBrowserPaneIdentity(active, identity))) return false
    revision++
    const previous = active
    active = undefined
    previous.claim = undefined
    previous.lastUsed = ++contextUse
    if (previous.pending) remove(previous)
    prune()
    return true
  }

  const claim = (target: BrowserPaneIdentity): Promise<BrowserPaneClaim<Context, Lease>> => {
    if (disposed) return Promise.reject(new Error("Browser pane lifecycle is disposed"))
    if (active && sameBrowserPaneIdentity(active, target)) {
      if (active.claim) return Promise.resolve(active.claim)
      if (active.pending) return active.pending
    }

    release()
    const identity: BrowserPaneIdentity = {
      serverKey: target.serverKey,
      sessionID: target.sessionID,
      bindingID: target.bindingID,
      endpointRevision: target.endpointRevision,
    }
    const key = contextKey(identity)
    const retained = contexts.get(key)
    if (retained && retained.endpointRevision !== identity.endpointRevision) {
      revision++
      remove(retained)
    }
    const reusable = contexts.get(key)
    if (reusable && !reusable.pending) {
      const next = { ...reusable, ...identity, lastUsed: ++contextUse }
      const result: BrowserPaneClaim<Context, Lease> = {
        ...identity,
        context: next.context,
        leaseID: input.lease(),
      }
      next.claim = result
      contexts.set(key, next)
      owners.set(next.context, next)
      active = next
      return Promise.resolve(result)
    }

    const current = ++revision
    const created = (() => {
      try {
        return input.create(identity)
      } catch (error) {
        return { error }
      }
    })()
    if ("error" in created) return Promise.reject(created.error)
    const next: Slot<Context, Lease> = {
      ...identity,
      key,
      context: created.context,
      revision: current,
      lastUsed: ++contextUse,
    }
    contexts.set(key, next)
    owners.set(next.context, next)
    active = next
    next.pending = Promise.resolve(created.ready)
      .then(() => {
        if (active !== next || contexts.get(key) !== next || next.revision !== revision) {
          throw new BrowserPaneSupersededError()
        }
        const result: BrowserPaneClaim<Context, Lease> = {
          ...identity,
          context: next.context,
          leaseID: input.lease(),
        }
        next.claim = result
        next.pending = undefined
        return result
      })
      .catch((error) => {
        if (active !== next || contexts.get(key) !== next || next.revision !== revision) {
          throw new BrowserPaneSupersededError()
        }
        remove(next)
        throw error
      })
    prune()
    return next.pending
  }

  const crash = (context: Context) => {
    const slot = owners.get(context)
    if (!slot || contexts.get(slot.key) !== slot) return undefined
    revision++
    const identity: BrowserPaneIdentity = {
      serverKey: slot.serverKey,
      sessionID: slot.sessionID,
      bindingID: slot.bindingID,
      endpointRevision: slot.endpointRevision,
    }
    remove(slot)
    return identity
  }

  return {
    claim,
    release,
    crash,
    state: () =>
      active && {
        context: active.context,
        serverKey: active.serverKey,
        sessionID: active.sessionID,
        bindingID: active.bindingID,
        endpointRevision: active.endpointRevision,
        leaseID: active.claim?.leaseID,
      },
    current: () => active?.claim,
    owns: (context: Context) => active?.context === context,
    contains: (context: Context) => {
      const slot = owners.get(context)
      return !!slot && contexts.get(slot.key) === slot
    },
    isCurrent: (claim: BrowserPaneClaim<Context, Lease>) => active?.claim === claim,
    dispose() {
      if (disposed) return
      disposed = true
      revision++
      active = undefined
      for (const slot of contexts.values()) close(slot.context)
      contexts.clear()
    },
  }
}

export type BrowserPaneLifecycle<Context extends object, Lease extends string = string> = ReturnType<
  typeof createBrowserPaneLifecycle<Context, Lease>
>

function contextKey(identity: BrowserPaneIdentity) {
  return JSON.stringify([identity.serverKey, identity.sessionID])
}
