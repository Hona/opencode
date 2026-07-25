export class SupersededError extends Error {
  constructor() {
    super("Browser pane context was superseded")
    this.name = "BrowserPaneSupersededError"
  }
}

export type BrowserPaneClaim<Context> = {
  context: Context
  sessionID: string
  lease: string
}

export type BrowserPaneOperation = { started: boolean }

export function startBrowserPaneOperation<Result>(operation: BrowserPaneOperation, run: () => PromiseLike<Result>) {
  operation.started = true
  return run()
}

export async function fenceBrowserPaneOperation<Context extends object, Result>(input: {
  operation: BrowserPaneOperation
  context: Context
  run(): Promise<Result>
  replace(context: Context): void
}) {
  try {
    return await input.run()
  } catch (error) {
    if (input.operation.started && operationFailure(error)) input.replace(input.context)
    throw error
  }
}

function operationFailure(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false
  return error.code === "aborted" || error.code === "timeout"
}

type Slot<Context> = {
  context: Context
  sessionID: string
  revision: number
  pending?: Promise<BrowserPaneClaim<Context>>
  claim?: BrowserPaneClaim<Context>
}

export function createBrowserPaneLifecycle<Context extends object>(input: {
  create(sessionID: string): { context: Context; ready: Promise<unknown> }
  close(context: Context): void
  lease(): string
}) {
  let revision = 0
  let disposed = false
  let slot: Slot<Context> | undefined
  const closed = new WeakSet<Context>()

  const close = (context: Context) => {
    if (closed.has(context)) return
    closed.add(context)
    input.close(context)
  }

  const release = (sessionID?: string) => {
    if (!slot || (sessionID && slot.sessionID !== sessionID)) return false
    revision++
    const previous = slot
    slot = undefined
    close(previous.context)
    return true
  }

  const claim = (sessionID: string): Promise<BrowserPaneClaim<Context>> => {
    if (disposed) return Promise.reject(new Error("Browser pane lifecycle is disposed"))
    if (slot?.sessionID === sessionID) {
      if (slot.claim) return Promise.resolve(slot.claim)
      if (slot.pending) return slot.pending
    }

    release()
    const current = ++revision
    const created = (() => {
      try {
        return input.create(sessionID)
      } catch (error) {
        return { error }
      }
    })()
    if ("error" in created) return Promise.reject(created.error)
    const next: Slot<Context> = { context: created.context, sessionID, revision: current }
    slot = next
    next.pending = Promise.resolve(created.ready)
      .then(() => {
        if (slot !== next || next.revision !== revision) throw new SupersededError()
        const result = { context: next.context, sessionID, lease: input.lease() }
        next.claim = result
        next.pending = undefined
        return result
      })
      .catch((error) => {
        if (slot !== next || next.revision !== revision) throw new SupersededError()
        if (slot === next) {
          slot = undefined
          close(next.context)
        }
        throw error
      })
    return next.pending
  }

  const crash = (context: Context) => {
    if (slot?.context !== context) return undefined
    const sessionID = slot.sessionID
    release(sessionID)
    return sessionID
  }

  return {
    claim,
    release,
    crash,
    state: () =>
      slot && {
        context: slot.context,
        sessionID: slot.sessionID,
        lease: slot.claim?.lease,
      },
    current: () => slot?.claim,
    owns: (context: Context) => slot?.context === context,
    isCurrent: (claim: BrowserPaneClaim<Context>) => slot?.claim === claim,
    dispose() {
      if (disposed) return
      disposed = true
      release()
    },
  }
}

export type BrowserPaneLifecycle<Context extends object> = ReturnType<typeof createBrowserPaneLifecycle<Context>>
