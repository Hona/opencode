import { batch, createEffect, createSignal, getOwner, on, onCleanup, runWithOwner, untrack } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { Browser } from "@opencode/plugin-browser/rpc"
import { Layout, Links, Sessions, type Context, type Link, type RemoteClient, type SessionRef } from "../sdk"
import { isHtml, resolveLink, workspaceFileURL } from "./link"
import { BrowserPane, type PaneEvent } from "./remote"

type Client = RemoteClient<(typeof BrowserPane)["spec"]>
type Session = Pick<SessionRef, "key">

type Registration = {
  /** Creates a restored tab's page, which then reports its surface. */
  load(tabID: Browser.TabID): void
  command(command: Browser.Action): Promise<void>
  close(): void
}

type ConnectionState = {
  registration?: Registration
  browser: Browser.State | null
  /** Host surface per tab page of the current registration. */
  surfaces: Readonly<Record<string, string>>
  suspended: boolean
  error?: string
}

/** What panels read. `registration` numbers each registration so a new one is observable. */
type Attachment = {
  registration?: number
  browser: Browser.State | null
  surfaces: Readonly<Record<string, string>>
  suspended: boolean
  error?: string
}

type Live = {
  ref: SessionRef
  connection: ReturnType<typeof createConnection>
  registration?: Registration
  revision: number
  /** Tab IDs of the last inventory, to tell new tabs from ones the user just closed. */
  tabs?: readonly Browser.TabID[]
  dispose: () => void
}

/** A mounted pane; the newest one answers the reload command. */
type PaneHandle = { visible: () => boolean; address: () => string; reload: () => void }

export type Model = ReturnType<typeof createModel>

// Attachments belong to the shell session tab, not the session route: native pages and the agent's
// browser survive visiting Settings or another tab and close when the session tab does.
export function createModel(ctx: Context) {
  const sessions = ctx.use(Sessions)
  const layout = ctx.use(Layout)
  const links = ctx.use(Links)
  const client = ctx.use(BrowserPane)
  const owner = getOwner()
  const [state, setState] = createStore({
    attachments: {} as Record<string, Attachment | undefined>,
    // Servers whose plugin lacks the browser RPC; sessions on them stop retrying.
    unsupported: {} as Record<string, true | undefined>,
    errors: {} as Record<string, string | undefined>,
  })
  const [panes, setPanes] = createSignal<readonly PaneHandle[]>([])
  const live = new Map<string, Live>()
  const listeners = new Map<string, (event: PaneEvent) => void>()
  const key = (tabID: string) => `${ctx.id}:${tabID}`

  createEffect(() => {
    const current = client()
    if (!current) return
    onCleanup(current.on("event", (value) => listeners.get(value.binding)?.(value.event)))
  })

  const close = (id: string) => {
    live.get(id)?.dispose()
    live.delete(id)
    setState("attachments", id, undefined)
  }

  // Mirror the desktop's tab inventory into the session's side panel. Only tabs new since the last
  // inventory are added, so a tab the user just closed is not reopened before the desktop confirms.
  const mirror = (entry: Live, ids: readonly Browser.TabID[] | undefined) => {
    const known = new Set(entry.tabs ?? [])
    entry.tabs = ids
    if (!ids) return
    known.forEach((tabID) => {
      if (!ids.includes(tabID) && layout.state(key(tabID), entry.ref) !== "closed") layout.close(key(tabID), entry.ref)
    })
    ids.forEach((tabID) => {
      if (!known.has(tabID) && layout.state(key(tabID), entry.ref) === "closed")
        layout.open(key(tabID), entry.ref, { focus: false })
    })
  }

  const attach = (ref: SessionRef) => {
    const id = ref.key
    if (live.has(id) || state.unsupported[ref.server.id] || !ref.server.compatible) return
    const entry: Live = {
      ref,
      revision: 0,
      dispose: () => undefined,
      connection: createConnection({
        client,
        listen(binding, listener) {
          listeners.set(binding, listener)
          return () => {
            listeners.delete(binding)
          }
        },
        target: () => ({ server: ref.server.id, session: ref.id }),
        // Focus requests write to the owning session's panel even while another shell tab is routed,
        // so the side panel and browser tab are already selected when the user returns to it.
        focus: (tabID) => layout.open(key(tabID), ref, { select: true }),
        preview: (path) => preview(ref, path),
        change: (next) => {
          if (next.error === "browser.pane.unsupported") {
            setState("unsupported", ref.server.id, true)
            return close(id)
          }
          if (next.registration !== entry.registration) {
            entry.registration = next.registration
            if (next.registration) entry.revision++
          }
          batch(() => {
            setState(
              "attachments",
              id,
              reconcile({
                registration: next.registration ? entry.revision : undefined,
                browser: next.browser,
                surfaces: next.surfaces,
                suspended: next.suspended,
                error:
                  next.error === "browser.pane.replaced"
                    ? ctx.t("replaced")
                    : next.error
                      ? ctx.t("common.requestFailed")
                      : undefined,
              }),
            )
            // After the store: closing a strip tab asks this model whether the desktop still has it.
            mirror(
              entry,
              next.browser?.tabs.map((item) => item.id),
            )
          })
        },
      }),
    }
    live.set(id, entry)
    setState("attachments", id, { browser: null, surfaces: {}, suspended: false })
    // A new session appears in the UI before its server-side creation finishes. The listener
    // belongs to this model, not to the route effect that happened to call attach().
    const data = ref.server.data
    const unsubscribe = runWithOwner(owner, () => [
      data.on("session.created", (event) => {
        if (event.data.sessionID === ref.id) entry.connection.wake()
      }),
      data.on("session.execution.started", (event) => {
        if (event.data.sessionID === ref.id) entry.connection.wake()
      }),
    ])
    if (!ref.pending) entry.connection.wake()
    entry.dispose = () => {
      unsubscribe?.forEach((dispose) => dispose())
      entry.connection.dispose()
    }
  }

  createEffect(() => {
    const view = sessions.current()
    if (!view?.id) return
    const ref = sessions.list().find((item) => item.key === view.key)
    if (ref) untrack(() => attach(ref))
  })

  createEffect(() => {
    const owned = new Set(sessions.list().map((ref) => ref.key))
    // The store's keys mirror `live`, and reading them keeps this effect subscribed to new attachments.
    Object.keys(state.attachments).forEach((id) => {
      const entry = live.get(id)
      if (!entry) return
      if (owned.has(id) && entry.ref.server.compatible) return
      close(id)
    })
  })
  onCleanup(() => Array.from(live.keys()).forEach(close))

  const wakeCurrent = () => {
    if (document.visibilityState !== "visible") return
    const view = sessions.current()
    if (view) live.get(view.key)?.connection.wake()
  }
  // These are edges, not a reactive dependency on suspended state: eviction while the window
  // remains focused must not immediately reopen the browser and defeat resource cleanup.
  createEffect(on(() => sessions.current()?.key, wakeCurrent))
  // The pane is reachable again after its main extension started or restarted.
  createEffect(
    on(
      () => !!client(),
      (available) => available && wakeCurrent(),
      { defer: true },
    ),
  )
  makeEventListener(window, "focus", wakeCurrent)
  makeEventListener(document, "visibilitychange", wakeCurrent)
  makeEventListener(document, "pointerdown", wakeCurrent)
  makeEventListener(document, "keydown", wakeCurrent)

  const attachment = (session: Session) => state.attachments[session.key]
  const attached = (session: Session) => {
    const value = attachment(session)
    return value?.registration !== undefined || !!value?.browser
  }
  const available = (session: SessionRef) =>
    !state.unsupported[session.server.id] && !!session.id && session.server.compatible && !layout.narrow()
  const tab = (session: Session, tabID: string) => attachment(session)?.browser?.tabs.find((item) => item.id === tabID)

  const command = (session: Session, action: Browser.Action) => {
    const id = session.key
    setState("errors", id, undefined)
    // An unreachable pane is suspended, not a failed request.
    const failed = (error: unknown) => {
      if (!unavailable(error)) setState("errors", id, ctx.t("common.requestFailed"))
    }
    const connection = live.get(id)?.connection
    if (!connection) return failed(new Error("browser.pane.unavailable"))
    void connection.command(action).catch(failed)
  }
  const openURL = (session: Session, url: string) => command(session, { type: "tabs.open", url })

  // Only the routed session has a file model to resolve workspace paths with.
  const files = (session: Session) => {
    const view = sessions.current()
    return view?.key === session.key ? view.file : undefined
  }
  // The desktop's own sidecar shares this disk, and its browser pane accepts file:// URLs inside the
  // session workspace only. Forwarded loopback servers do not qualify, matching the desktop policy.
  const canOpen = (session: SessionRef, path?: string) => {
    if (!session.server.builtin || !available(session) || !attached(session)) return false
    if (path === undefined) return true
    const current = files(session)
    return !!current && !current.absolute(path)
  }
  const openFile = (session: Session, path: string) => {
    const current = files(session)
    if (current) openURL(session, workspaceFileURL(current, path))
  }

  // HTML the pane can load opens as a browser tab. Palette results and comment chips name files to
  // edit, so they keep opening file tabs.
  const target = (link: Link) => {
    if (link.exact || link.origin || !link.session) return
    const view = sessions.current()
    if (view?.key !== link.session.key) return
    const path = resolveLink(view.file, link.href, link.base)
    if (!path || !isHtml(path) || !canOpen(view, path)) return
    return { view, path }
  }

  // The agent's browser.preview tool: the link router picks the browser for HTML, the file panel otherwise.
  const preview = (ref: SessionRef, path: string) => {
    const view = sessions.current()
    if (view?.key === ref.key) links.open({ href: path, session: view })
  }

  return {
    available,
    attached,
    canOpen,
    openFile,
    openURL,
    command,
    tab,
    open(session: SessionRef) {
      if (available(session)) command(session, { type: "tabs.open" })
    },
    /** Tab IDs to list in the side panel: the desktop's inventory, limited to tabs stored in the strip. */
    tabs(session: Session, open: readonly string[]) {
      if (!attached(session)) return []
      return attachment(session)?.browser?.tabs.flatMap((item) => (open.includes(item.id) ? [item.id] : [])) ?? []
    },
    error: (session: Session) => state.errors[session.key] ?? attachment(session)?.error,
    suspended: (session: Session) => attachment(session)?.suspended ?? false,
    /** The host surface of a tab's page, once main created the page. */
    surface: (session: Session, tabID: string) => attachment(session)?.surfaces[tabID],
    load(session: Session, tabID: Browser.TabID) {
      if (attachment(session)?.registration === undefined) return
      live.get(session.key)?.registration?.load(tabID)
    },
    closeTab(session: Session, tabID: string) {
      const item = tab(session, tabID)
      if (item) command(session, { type: "tabs.close", tabID: item.id })
    },
    focusTab(session: Session, tabID: string) {
      const item = tab(session, tabID)
      if (item && item.id !== attachment(session)?.browser?.focusedTabID)
        command(session, { type: "tabs.focus", tabID: item.id })
    },
    match: (link: Link) => !!target(link),
    openLink(link: Link) {
      const found = target(link)
      if (found) openFile(found.view, found.path)
    },
    pane: () => panes()[0],
    mount(handle: PaneHandle) {
      setPanes((list) => [handle, ...list])
      return () => setPanes((list) => list.filter((item) => item !== handle))
    },
  }
}

// Owns native registration, retry, and suspended tab metadata independently of the mounted session route.
function createConnection(input: {
  client: () => Client | undefined
  listen: (binding: string, listener: (event: PaneEvent) => void) => () => void
  target: () => { server: string; session: string }
  change: (state: ConnectionState) => void
  focus: (tabID: Browser.TabID) => void
  preview: (path: string) => void
}) {
  const state: ConnectionState = { browser: null, surfaces: {}, suspended: false }
  let disposed = false
  let blocked = false
  let attempts = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  // The pane itself is unreachable while its main extension restarts. Keep the tabs, like an idle
  // eviction; the next interaction or the pane's return registers again.
  const suspend = (registration: Registration) => {
    if (disposed || state.registration !== registration) return
    registration.close()
    state.registration = undefined
    state.surfaces = {}
    state.suspended = true
    state.error = undefined
    input.change({ ...state })
  }
  const register = () => {
    if (disposed || blocked || state.registration) return
    const current = input.client()
    if (!current) return
    clearTimeout(retry)
    const registration: Registration = open(
      current,
      input.listen,
      { ...input.target(), ...(state.browser ? { restore: state.browser } : {}) },
      (event) => {
        if (disposed || state.registration !== registration) return
        if (event.type === "focus") return input.focus(event.tabID)
        if (event.type === "preview") return input.preview(event.path)
        if (event.type === "surface") {
          state.surfaces = { ...state.surfaces, [event.tabID]: event.surface }
          return input.change({ ...state })
        }
        if (event.error === "browser.pane.unsupported" || event.error === "browser.pane.replaced") {
          blocked = true
          registration.close()
          state.registration = undefined
          state.surfaces = {}
          state.browser = null
          state.error = event.error
          input.change({ ...state })
          return
        }
        if (event.error === "browser.pane.suspended" || event.error === "browser.pane.registration.closed") {
          registration.close()
          state.registration = undefined
          state.surfaces = {}
          state.suspended = event.error === "browser.pane.suspended"
          if (state.suspended && event.state) state.browser = event.state
          state.error = undefined
          input.change({ ...state })
          // Idle eviction has no retry timer. A user or Session execution wakes it on demand.
          if (!state.suspended) retry = setTimeout(register, Math.min(30_000, 1_000 * 2 ** attempts++))
          return
        }
        if (event.state) attempts = 0
        state.browser = event.state
        state.error = event.error
        input.change({ ...state })
      },
      (error) => {
        if (unavailable(error)) suspend(registration)
      },
    )
    state.registration = registration
    state.surfaces = {}
    state.suspended = false
    state.error = undefined
    input.change({ ...state })
  }
  return {
    wake: register,
    command(command: Browser.Action) {
      register()
      const registration = state.registration
      if (!registration) {
        const error = new Error("browser.pane.unavailable")
        return Promise.reject(input.client() ? error : Object.assign(error, { code: "unavailable" }))
      }
      return registration.command(command).catch((error: unknown) => {
        if (unavailable(error)) suspend(registration)
        throw error
      })
    },
    dispose() {
      disposed = true
      clearTimeout(retry)
      state.registration?.close()
      state.registration = undefined
    },
  }
}

function open(
  client: Client,
  listen: (binding: string, listener: (event: PaneEvent) => void) => () => void,
  target: { server: string; session: string; restore?: Browser.State },
  listener: (event: PaneEvent) => void,
  failed: (error: unknown) => void,
): Registration {
  const binding = crypto.randomUUID()
  const status = { closed: false }
  const stop = listen(binding, (event) => {
    if (!status.closed) listener(event)
  })
  const ready = client.register({ binding, ...target })
  // Other failures reach the owner through the closed-state event; keep the bare promise handled.
  void ready.catch(failed)
  return {
    load(tabID) {
      if (status.closed) return
      void ready.then(() => client.load({ binding, tabID })).catch(() => undefined)
    },
    command: (command) => ready.then(() => client.command({ binding, command })),
    close() {
      if (status.closed) return
      status.closed = true
      stop()
      void ready.then(() => client.close({ binding })).catch(() => undefined)
    },
  }
}

// The bridge rejects with code "unavailable" while the pane's main extension is not running.
function unavailable(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "unavailable"
}
