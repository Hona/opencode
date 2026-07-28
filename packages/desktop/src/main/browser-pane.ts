import { randomUUID } from "node:crypto"
import { Browser, BrowserDriver, type BrowserAttachment, type OpenCodeClient } from "@opencode-ai/client/node"
import { BrowserWindow, View, WebContentsView } from "electron"
import { installBrowserNetwork } from "./browser-network"
import { browserPaneRetryCandidate, emptyBrowserPaneState } from "./browser-pane-coordination"
import {
  allowedBrowserDestination,
  boundedBrowserOperation,
  browserBottomMasks,
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
  type BrowserPaneBounds,
} from "./browser-pane-policy"
import {
  BrowserPaneSupersededError,
  createBrowserPaneLifecycle,
  fenceBrowserPaneOperation,
  sameBrowserPaneIdentity,
  sameBrowserPaneSession,
  startBrowserPaneOperation,
  type BrowserPaneClaim,
  type BrowserPaneIdentity,
  type BrowserPaneLifecycle,
  type BrowserPaneOperation,
} from "./browser-pane-lifecycle"

export type { BrowserPaneBounds, BrowserPaneIdentity }

export type BrowserPaneState = {
  readonly url: string
  readonly title: string
  readonly loading: boolean
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly error?: string
}

export type BrowserPaneStateUpdate = BrowserPaneIdentity & { readonly state: BrowserPaneState }

export type BrowserPaneLayout = {
  readonly attached: boolean
  readonly visible: boolean
  readonly destroy?: boolean
  readonly background?: string
  readonly bounds?: BrowserPaneBounds
}

export type BrowserPaneCommand =
  | { readonly type: "navigate"; readonly url: string }
  | { readonly type: "back" }
  | { readonly type: "forward" }
  | { readonly type: "reload" }
  | { readonly type: "stop" }

export interface BrowserPaneClients {
  readonly client: (identity: BrowserPaneIdentity) => OpenCodeClient
}

export class BrowserPaneError extends Error {
  readonly code: Browser.ErrorCode

  constructor(code: Browser.ErrorCode, message: string) {
    super(message)
    this.name = "BrowserPaneError"
    this.code = code
  }
}

type Ref = { readonly snapshot: number; readonly token: string; readonly objectID: string }
type Page = {
  readonly win: BrowserWindow
  readonly identity: BrowserPaneIdentity
  readonly view: WebContentsView
  readonly session: Electron.Session
  document: number
  snapshot: number
  nextRef: number
  snapshotObjectID?: string
  approvedOrigin?: string
  readonly refs: Map<string, Ref>
  readonly attachmentAbort: AbortController
  readonly listeners: Set<(state: Browser.State) => void>
  attachment?: BrowserAttachment<Page>
  activation?: () => Promise<void> | void
  closed: boolean
  readonly cleanups: Array<() => void>
  state: BrowserPaneState
}
type Entry = {
  readonly win: BrowserWindow
  readonly masks: View[]
  readonly lifecycle: BrowserPaneLifecycle<Page>
  desired?: DesiredLayout
  disposed: boolean
  readonly cleanups: Array<() => void>
  readonly requests: Set<AbortController>
  active?: { readonly controller: AbortController; readonly page: Page }
  state: BrowserPaneState
  queue: Promise<void>
}
type AttachedLayout = BrowserPaneLayout
type DesiredLayout = { readonly identity: BrowserPaneIdentity; readonly layout: AttachedLayout }
type SnapshotNode = {
  readonly token?: string
  readonly role: string
  readonly name: string
  readonly value: string
  readonly depth: number
  readonly checked?: boolean
  readonly disabled?: boolean
  readonly expanded?: boolean
  readonly selected?: boolean
}

const debuggerCommandTimeout = 10_000

export function createBrowserPaneController(clients: BrowserPaneClients) {
  const entries = new Map<number, Entry>()

  const publishDriverState = (page: Page) => {
    const state = contractState(page.state, page.document)
    page.listeners.forEach((listener) => listener(state))
  }

  const publish = (entry: Entry, page?: Page, error?: string, identity?: BrowserPaneIdentity) => {
    if (page && !entry.lifecycle.contains(page)) return entry.state
    const contents = page?.view.webContents
    const message = error?.slice(0, 1_024)
    const state =
      contents && !contents.isDestroyed()
        ? {
            url: contents.getURL().slice(0, 16_384),
            title: contents.getTitle().slice(0, 1_024),
            loading: contents.isLoading(),
            canGoBack: contents.navigationHistory.canGoBack(),
            canGoForward: contents.navigationHistory.canGoForward(),
            ...(message ? { error: message } : {}),
          }
        : { ...entry.state, loading: false, ...(message ? { error: message } : {}) }
    if (page) {
      page.state = state
      publishDriverState(page)
      if (!entry.lifecycle.owns(page)) return state
    }
    entry.state = state
    const owner = identity ?? entry.lifecycle.state() ?? page?.identity ?? entry.desired?.identity
    if (!entry.win.isDestroyed() && owner) {
      entry.win.webContents.send("browser-pane-state", {
        serverKey: owner.serverKey,
        sessionID: owner.sessionID,
        bindingID: owner.bindingID,
        endpointRevision: owner.endpointRevision,
        state,
      } satisfies BrowserPaneStateUpdate)
    }
    return state
  }

  const disposePage = (page: Page) => {
    if (page.closed) return
    page.closed = true
    page.attachmentAbort.abort(new BrowserPaneSupersededError())
    void page.attachment?.close().catch(() => undefined)
    invalidateRefs(page)
    const contents = page.view.webContents
    const browserSession = page.session
    page.cleanups.splice(0).forEach((cleanup) => {
      try {
        cleanup()
      } catch {}
    })
    try {
      browserSession.setPermissionRequestHandler(null)
      browserSession.setPermissionCheckHandler(null)
      browserSession.setDevicePermissionHandler(null)
      browserSession.setDisplayMediaRequestHandler(null)
    } finally {
      if (!page.win.isDestroyed()) page.win.contentView.removeChildView(page.view)
      if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false })
    }
  }

  const createPage = (win: BrowserWindow, masks: View[], identity: BrowserPaneIdentity) => {
    const client = clients.client(identity)
    const view = new WebContentsView({
      webPreferences: {
        partition: browserContextPartition(identity.serverKey, identity.sessionID, identity.bindingID, randomUUID()),
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        plugins: false,
        experimentalFeatures: false,
        safeDialogs: true,
        disableDialogs: true,
        navigateOnDragDrop: false,
        autoplayPolicy: "document-user-activation-required",
        focusOnNavigation: false,
        devTools: false,
      },
    })
    view.setVisible(false)
    view.setBorderRadius(0)
    view.setBackgroundColor("#ffffff")
    win.contentView.addChildView(view)
    masks.forEach((mask) => win.contentView.addChildView(mask))
    const page: Page = {
      win,
      identity,
      view,
      session: view.webContents.session,
      document: 0,
      snapshot: 0,
      nextRef: 0,
      approvedOrigin: "about:blank",
      refs: new Map(),
      attachmentAbort: new AbortController(),
      listeners: new Set(),
      closed: false,
      cleanups: [],
      state: emptyBrowserPaneState(),
    }

    const contents = view.webContents
    const browserSession = contents.session
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.setDevicePermissionHandler(() => false)
    browserSession.setDisplayMediaRequestHandler((_request, callback) => callback({}))
    const onDownload = (event: Electron.Event) => event.preventDefault()
    browserSession.on("will-download", onDownload)
    page.cleanups.push(() => browserSession.off("will-download", onDownload))

    const preventUnsafeNavigation = (
      event: Electron.Event<Electron.WebContentsWillNavigateEventParams | Electron.WebContentsWillRedirectEventParams>,
    ) => {
      if (allowedBrowserDestination(event.url, page.approvedOrigin)) return
      event.preventDefault()
      const entry = entries.get(win.id)
      if (entry) publish(entry, page, "Navigation was blocked by the browser security policy")
    }
    contents.on("will-navigate", preventUnsafeNavigation)
    page.cleanups.push(() => contents.off("will-navigate", preventUnsafeNavigation))
    contents.on("will-redirect", preventUnsafeNavigation)
    page.cleanups.push(() => contents.off("will-redirect", preventUnsafeNavigation))
    contents.setWindowOpenHandler(() => ({ action: "deny" }))
    const onBounds = (event: Electron.Event) => event.preventDefault()
    contents.on("content-bounds-updated", onBounds)
    page.cleanups.push(() => contents.off("content-bounds-updated", onBounds))

    const onPublish = () => {
      const entry = entries.get(win.id)
      if (entry) publish(entry, page)
    }
    contents.on("did-start-loading", onPublish)
    page.cleanups.push(() => contents.off("did-start-loading", onPublish))
    contents.on("did-stop-loading", onPublish)
    page.cleanups.push(() => contents.off("did-stop-loading", onPublish))
    contents.on("did-navigate", onPublish)
    page.cleanups.push(() => contents.off("did-navigate", onPublish))
    contents.on("did-navigate-in-page", onPublish)
    page.cleanups.push(() => contents.off("did-navigate-in-page", onPublish))
    contents.on("page-title-updated", onPublish)
    page.cleanups.push(() => contents.off("page-title-updated", onPublish))

    const onStartNavigation = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (!event.isMainFrame) return
      const entry = entries.get(win.id)
      if (!entry?.lifecycle.contains(page)) return
      page.document++
      invalidateRefs(page)
      page.state = { ...page.state, url: event.url.slice(0, 16_384), loading: true }
      publishDriverState(page)
      if (!entry.lifecycle.owns(page)) return
      entry.state = page.state
    }
    contents.on("did-start-navigation", onStartNavigation)
    page.cleanups.push(() => contents.off("did-start-navigation", onStartNavigation))
    const onFailLoad = (
      _event: Electron.Event,
      code: number,
      description: string,
      _url: string,
      isMainFrame: boolean,
    ) => {
      if (!isMainFrame || code === -3) return
      const entry = entries.get(win.id)
      if (entry) publish(entry, page, description)
    }
    contents.on("did-fail-load", onFailLoad)
    page.cleanups.push(() => contents.off("did-fail-load", onFailLoad))

    const replace = (message: string) => {
      const entry = entries.get(win.id)
      if (entry) replacePage(entry, page, message)
    }
    const onRenderGone = () => replace("The browser page crashed")
    contents.on("render-process-gone", onRenderGone)
    page.cleanups.push(() => contents.off("render-process-gone", onRenderGone))
    const browserDebugger = contents.debugger
    const onDebuggerDetach = () => replace("The browser debugger detached")
    browserDebugger.on("detach", onDebuggerDetach)
    page.cleanups.push(() => browserDebugger.off("detach", onDebuggerDetach))

    const driver = BrowserDriver.define<Page>(async ({ proxy, signal }) => {
      const cleanup = await installBrowserNetwork({ proxy, session: browserSession, webContents: contents })
      let disposed = false
      const dispose = () => {
        if (disposed) return
        disposed = true
        if (page.activation === dispose) page.activation = undefined
        page.listeners.clear()
        cleanup()
      }
      page.activation = dispose
      return Promise.resolve()
        .then(() => {
          const entry = entries.get(win.id)
          if (signal.aborted) throw signal.reason ?? new BrowserPaneSupersededError()
          if (!entry || !ownsDesiredPage(entry, page, identity)) throw new BrowserPaneSupersededError()
          return contents.loadURL("about:blank")
        })
        .then(() => {
          const entry = entries.get(win.id)
          if (signal.aborted) throw signal.reason ?? new BrowserPaneSupersededError()
          if (!entry || !ownsDesiredPage(entry, page, identity)) throw new BrowserPaneSupersededError()
          return {
            resource: page,
            state: () => contractState(page.state, page.document),
            subscribe(listener: (state: Browser.State) => void) {
              page.listeners.add(listener)
              listener(contractState(page.state, page.document))
              return () => {
                page.listeners.delete(listener)
              }
            },
            execute(command: Browser.Command, options: { readonly signal: AbortSignal }) {
              const current = entries.get(win.id)
              if (!current) {
                return Promise.reject(browserError("not_attached", "The browser pane is no longer attached."))
              }
              return executeDriver(current, page, identity, command, AbortSignal.any([signal, options.signal]))
            },
            dispose,
          }
        })
        .catch((error) => {
          dispose()
          throw error
        })
    })
    const ready = client.browser
      .attach({ sessionID: identity.sessionID, driver, signal: page.attachmentAbort.signal })
      .then(async (attachment) => {
        page.attachment = attachment
        if (!page.closed) return
        await attachment.close()
        throw new BrowserPaneSupersededError()
      })

    return {
      context: page,
      ready,
    }
  }

  const createEntry = (win: BrowserWindow) => {
    const masks = Array.from({ length: 8 }, () => new View())
    masks.forEach((mask) => {
      mask.setVisible(false)
      win.contentView.addChildView(mask)
    })
    const entry: Entry = {
      win,
      masks,
      lifecycle: createBrowserPaneLifecycle<Page>({
        create: (identity) => createPage(win, masks, identity),
        close: disposePage,
        lease: randomUUID,
        limit: 0,
      }),
      disposed: false,
      cleanups: [],
      requests: new Set(),
      state: emptyBrowserPaneState(),
      queue: Promise.resolve(),
    }
    entries.set(win.id, entry)
    const onParentNavigation = () => detachEntry(entry)
    win.webContents.on("did-start-navigation", onParentNavigation)
    entry.cleanups.push(() => win.webContents.off("did-start-navigation", onParentNavigation))
    const onParentGone = () => detachEntry(entry)
    win.webContents.on("render-process-gone", onParentGone)
    entry.cleanups.push(() => win.webContents.off("render-process-gone", onParentGone))
    const onClosed = () => disposeEntry(entry)
    win.once("closed", onClosed)
    entry.cleanups.push(() => win.off("closed", onClosed))
    return entry
  }

  const setLayout = (win: BrowserWindow, binding: BrowserPaneIdentity, layout: BrowserPaneLayout) => {
    const entry = entries.get(win.id)
    const identity = requireIdentity(binding)
    if (layout.destroy) {
      if (entry && ownsIdentity(entry, identity)) disposeEntry(entry)
      return
    }
    if (!layout.attached) {
      if (entry) detachEntry(entry, identity)
      return
    }

    const next = entry ?? createEntry(win)
    const owner = [...entries.values()].find((item) => {
      if (item === next) return false
      const state = item.lifecycle.state()
      return state ? sameBrowserPaneSession(state, identity) : false
    })
    if (owner) {
      detachEntry(next)
      next.state = emptyBrowserPaneState()
      next.desired = { identity, layout }
      publish(next, undefined, "Browser tools for this server Session are attached in another window", identity)
      return
    }

    next.desired = { identity, layout }
    const state = next.lifecycle.state()
    if (!state || !sameBrowserPaneIdentity(state, identity)) {
      beginAttachment(next, identity, layout)
      return
    }
    const claim = next.lifecycle.current()
    if (!claim) {
      hideEntry(next)
      return
    }
    applyLayout(next, claim, layout)
  }

  const applyLayout = (entry: Entry, claim: BrowserPaneClaim<Page>, layout: AttachedLayout) => {
    if (!layout.visible || !layout.bounds || !entry.lifecycle.isCurrent(claim)) {
      hideEntry(entry)
      return
    }
    const bounds = normalizeBrowserBounds(layout.bounds, entry.win.contentView.getBounds())
    if (!bounds) {
      hideEntry(entry)
      return
    }
    claim.context.view.setBounds(bounds)
    claim.context.view.setVisible(true)
    const maskBounds = browserBottomMasks(bounds)
    entry.masks.forEach((mask, index) => {
      const next = maskBounds[index]
      if (!next) {
        mask.setVisible(false)
        return
      }
      mask.setBackgroundColor(layout.background ?? "#000000")
      mask.setBounds(next)
      entry.win.contentView.addChildView(mask)
      mask.setVisible(true)
    })
  }

  const beginAttachment = (entry: Entry, identity: BrowserPaneIdentity, layout: AttachedLayout) => {
    cancelEntry(entry)
    hideEntry(entry)
    entry.state = emptyBrowserPaneState()
    entry.desired = { identity, layout }
    publish(entry, undefined, undefined, identity)
    const pending = entry.lifecycle.claim(identity)
    void pending.then(
      (claim) => {
        if (!entry.lifecycle.isCurrent(claim)) return
        const desired = entry.desired
        if (!desired || !sameBrowserPaneIdentity(desired.identity, claim)) {
          entry.lifecycle.release(claim)
          return
        }
        publish(entry, claim.context)
        applyLayout(entry, claim, desired.layout)
      },
      (error) => {
        if (error instanceof BrowserPaneSupersededError) return
        const desired = entry.desired
        if (!desired || !sameBrowserPaneIdentity(desired.identity, identity)) return
        publish(entry, undefined, error instanceof Error ? error.message : String(error))
      },
    )
  }

  const replacePage = (entry: Entry, page: Page, message: string) => {
    if (!entry.lifecycle.contains(page)) return
    const attached = entry.lifecycle.owns(page)
    if (attached) cancelEntry(entry)
    page.document++
    if (!attached) invalidateRefs(page)
    const identity = entry.lifecycle.crash(page)
    if (!attached) return
    publish(entry, undefined, message)
    const desired = entry.desired
    if (!identity || !desired || !sameBrowserPaneIdentity(desired.identity, identity)) return
    beginAttachment(entry, desired.identity, desired.layout)
  }

  const command = async (win: BrowserWindow, binding: BrowserPaneIdentity, input: BrowserPaneCommand) => {
    const identity = requireIdentity(binding)
    const entry = entries.get(win.id)
    const claim = entry?.lifecycle.current()
    if (!entry || !claim || !sameBrowserPaneIdentity(claim, identity)) {
      throw browserError("not_attached", "The browser pane binding is no longer attached.")
    }
    if (input.type === "stop") {
      const running = entry.active
      stopBrowserOperation({
        active: running?.controller,
        stop: () => (running?.page ?? claim.context).view.webContents.stop(),
      })
      return
    }
    const controller = new AbortController()
    const operation = { started: false }
    entry.requests.add(controller)
    return enqueue(entry, () =>
      fenceBrowserPaneOperation({
        operation,
        context: claim.context,
        run: () =>
          active(entry, controller, claim.context, async () => {
            assertActive(entry, claim, claim.leaseID, controller.signal)
            switch (input.type) {
              case "navigate":
                await navigate(
                  claim.context,
                  input.url,
                  controller.signal,
                  () => assertActive(entry, claim, claim.leaseID, controller.signal),
                  operation,
                  () => publish(entry, claim.context),
                )
                return
              case "back":
                navigateHistory(claim.context, -1, operation)
                return
              case "forward":
                navigateHistory(claim.context, 1, operation)
                return
              case "reload":
                operation.started = true
                claim.context.view.webContents.reload()
                return
            }
          }),
        replace: (page) => replacePage(entry, page, "The browser context restarted after an interrupted operation"),
      }),
    ).finally(() => entry.requests.delete(controller))
  }

  const state = (win: BrowserWindow, binding: BrowserPaneIdentity) => {
    const identity = requireIdentity(binding)
    const entry = entries.get(win.id)
    return entry && ownsIdentity(entry, identity) ? entry.state : emptyBrowserPaneState()
  }

  const executeDriver = async (
    entry: Entry,
    page: Page,
    identity: BrowserPaneIdentity,
    command: Browser.Command,
    signal: AbortSignal,
  ) => {
    assertDriverActive(entry, page, identity, signal)
    const controller = new AbortController()
    const operation = { started: false }
    const onAbort = () => controller.abort()
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) controller.abort()
    entry.requests.add(controller)
    return enqueue(entry, () =>
      fenceBrowserPaneOperation({
        operation,
        context: page,
        run: () =>
          active(entry, controller, page, () => {
            const verify = () => assertDriverActive(entry, page, identity, controller.signal)
            verify()
            return execute(page, command, controller.signal, verify, operation, () => publish(entry, page))
          }),
        replace: (current) =>
          replacePage(entry, current, "The browser context restarted after an interrupted operation"),
      }),
    )
      .finally(() => {
        signal.removeEventListener("abort", onAbort)
        entry.requests.delete(controller)
      })
      .catch((error) => {
        throw normalizeBrowserError(error)
      })
  }

  const dispose = () => {
    for (const entry of entries.values()) disposeEntry(entry, false)
  }

  const detachEntry = (entry: Entry, identity?: BrowserPaneIdentity) => {
    const owner = entry.lifecycle.state()
    if (!detach(entry, identity)) return
    if (owner) retryBlocked(owner)
  }

  const invalidate = (serverKey: string) => {
    for (const entry of entries.values()) {
      const owner = entry.lifecycle.state()
      if (owner?.serverKey !== serverKey && entry.desired?.identity.serverKey !== serverKey) continue
      disposeEntry(entry, false)
    }
  }

  function disposeEntry(entry: Entry, retry = true) {
    if (entry.disposed) return
    const owner = entry.lifecycle.state()
    entry.disposed = true
    if (entries.get(entry.win.id) === entry) entries.delete(entry.win.id)
    cancelEntry(entry)
    entry.desired = undefined
    entry.lifecycle.dispose()
    entry.cleanups.splice(0).forEach((cleanup) => cleanup())
    if (!entry.win.isDestroyed()) entry.masks.forEach((mask) => entry.win.contentView.removeChildView(mask))
    if (retry && owner) retryBlocked(owner)
  }

  function retryBlocked(identity: BrowserPaneIdentity) {
    const id = browserPaneRetryCandidate(
      [...entries.values()].map((entry) => ({
        id: entry.win.id,
        owner: entry.lifecycle.state(),
        desired: entry.desired?.identity,
      })),
      identity,
    )
    if (id === undefined) return
    const entry = entries.get(id)
    const desired = entry?.desired
    if (!entry || !desired) return
    beginAttachment(entry, desired.identity, desired.layout)
  }

  return { setLayout, command, state, invalidate, dispose }
}

export type BrowserPaneController = ReturnType<typeof createBrowserPaneController>

async function execute(
  page: Page,
  command: Browser.Command,
  abort: AbortSignal,
  verify: () => void,
  operation: BrowserPaneOperation,
  refresh: () => BrowserPaneState,
): Promise<Browser.Result> {
  throwIfAborted(abort)
  if (page.closed || page.view.webContents.isDestroyed()) {
    throw browserError("page_crashed", "The browser page is no longer available.")
  }
  assertDocument(page, command.generation)
  switch (command.type) {
    case "navigate":
      await navigate(page, command.url, abort, verify, operation, refresh)
      return { type: "navigate", state: contractState(page.state, page.document) }
    case "snapshot":
      return snapshot(page, command.generation, abort, verify, operation, refresh)
    case "click":
      await click(page, command.ref, command.generation, abort, verify, operation)
      return { type: "click", state: refreshedState(page, refresh, verify) }
    case "fill":
      await fill(page, command.ref, command.text, command.generation, abort, verify, operation)
      return { type: "fill", state: refreshedState(page, refresh, verify) }
    case "press":
      await press(page, command.key, command.generation, abort, verify, operation)
      return { type: "press", state: refreshedState(page, refresh, verify) }
    case "scroll":
      await scroll(page, command.direction, command.pixels, command.generation, abort, verify, operation)
      return { type: "scroll", state: refreshedState(page, refresh, verify) }
    case "screenshot":
      return screenshot(page, command.generation, abort, verify, operation, refresh)
  }
  throw browserError("internal", "Unsupported browser command.")
}

async function navigate(
  page: Page,
  input: string,
  abort: AbortSignal | undefined,
  verify: (() => void) | undefined,
  operation: BrowserPaneOperation,
  refresh: () => BrowserPaneState,
) {
  const url = (() => {
    try {
      return normalizeBrowserURL(input)
    } catch {
      throw browserError("invalid_url", "Only HTTP, HTTPS, and about:blank URLs are supported.")
    }
  })()
  throwIfAborted(abort)
  page.approvedOrigin = browserDestinationOrigin(url)
  const onAbort = () => page.view.webContents.stop()
  abort?.addEventListener("abort", onAbort, { once: true })
  await boundedBrowserOperation(() => startBrowserPaneOperation(operation, () => page.view.webContents.loadURL(url)), {
    signal: abort,
    timeout: 30_000,
    aborted: () => browserError("aborted", "The browser navigation was aborted."),
    timedOut: () => {
      page.view.webContents.stop()
      return browserError("timeout", "The browser navigation timed out.")
    },
  })
    .catch((error) => {
      if (abort?.aborted) throw browserError("aborted", "The browser navigation was aborted.")
      if (error instanceof BrowserPaneError) throw error
      throw browserError("navigation_failed", error instanceof Error ? error.message : String(error))
    })
    .finally(() => abort?.removeEventListener("abort", onAbort))
  throwIfAborted(abort)
  verify?.()
  refresh()
  verify?.()
}

async function snapshot(
  page: Page,
  generation: number,
  abort: AbortSignal,
  verify: () => void,
  operation: BrowserPaneOperation,
  refresh: () => BrowserPaneState,
): Promise<Browser.Result> {
  throwIfAborted(abort)
  // The bounded main-world traversal intentionally omits cross-origin iframe contents and editable values.
  const object = await debuggerCommand(
    page,
    "Runtime.evaluate",
    { expression: browserSnapshotExpression(page.nextRef) },
    abort,
    operation,
  )
  const objectID = readRuntimeObjectID(object)
  const result = await debuggerCommand(
    page,
    "Runtime.callFunctionOn",
    {
      objectId: objectID,
      functionDeclaration: "function() { return this.result }",
      returnByValue: true,
    },
    abort,
    operation,
  )
    .then((response) => {
      verify()
      throwIfAborted(abort)
      assertDocument(page, generation)
      return readSnapshot(response)
    })
    .catch((error) => {
      releaseSnapshotObject(page, objectID)
      throw error
    })

  invalidateRefs(page)
  page.snapshotObjectID = objectID
  page.nextRef = Math.max(page.nextRef, result.nextRef)
  const lines = result.nodes.map((node) => {
    if (node.token) page.refs.set(node.token, { snapshot: page.snapshot, token: node.token, objectID })
    const properties = [
      node.checked === undefined ? undefined : `checked=${node.checked}`,
      node.disabled === undefined ? undefined : `disabled=${node.disabled}`,
      node.expanded === undefined ? undefined : `expanded=${node.expanded}`,
      node.selected === undefined ? undefined : `selected=${node.selected}`,
    ].filter((item): item is string => item !== undefined)
    const detail = [
      node.name ? JSON.stringify(node.name) : undefined,
      node.value && node.value !== node.name ? `value=${JSON.stringify(node.value)}` : undefined,
    ]
      .filter((item): item is string => item !== undefined)
      .join(" ")
    return `${"  ".repeat(node.depth)}${node.token ? `${node.token} ` : ""}[${node.role}]${detail ? ` ${detail}` : ""}${properties.length ? ` ${properties.join(" ")}` : ""}`
  })
  const content = [
    `Page: ${page.view.webContents.getTitle().replaceAll(/\s+/g, " ").trim().slice(0, 1_024)}`,
    `URL: ${page.view.webContents.getURL().slice(0, 16_384)}`,
    "",
    ...lines,
  ]
    .join("\n")
    .slice(0, 40 * 1_024)
  assertDocument(page, generation)
  verify()
  const state = refreshedState(page, refresh, verify)
  return {
    type: "snapshot",
    state,
    format: "opencode.semantic.v1",
    content,
  }
}

async function click(
  page: Page,
  ref: Browser.Ref,
  generation: number,
  abort: AbortSignal,
  verify: () => void,
  operation: BrowserPaneOperation,
) {
  const node = resolveRef(page, ref)
  const response = await debuggerCommand(
    page,
    "Runtime.callFunctionOn",
    {
      objectId: node.objectID,
      functionDeclaration:
        "function(token) { const element = this.refs[token]; if (!element || !element.isConnected) throw new Error('stale element'); element.scrollIntoView({ block: 'center', inline: 'center' }); const bounds = element.getBoundingClientRect(); if (bounds.width <= 0 || bounds.height <= 0) throw new Error('element has no bounds'); return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 } }",
      arguments: [{ value: node.token }],
      returnByValue: true,
    },
    abort,
    operation,
  )
  verify()
  const point = readPoint(response)
  throwIfAborted(abort)
  assertDocument(page, generation)
  await debuggerCommand(page, "Input.dispatchMouseEvent", { type: "mouseMoved", ...point }, abort, operation)
  verify()
  assertDocument(page, generation)
  await runBrowserInputPair({
    assert: () => {
      verify()
      assertDocument(page, generation)
    },
    press: () =>
      debuggerCommand(
        page,
        "Input.dispatchMouseEvent",
        { type: "mousePressed", button: "left", clickCount: 1, ...point },
        abort,
        operation,
      ).then(() => undefined),
    release: () =>
      debuggerCommand(
        page,
        "Input.dispatchMouseEvent",
        { type: "mouseReleased", button: "left", clickCount: 1, ...point },
        undefined,
        operation,
      ).then(() => undefined),
  })
}

async function fill(
  page: Page,
  ref: Browser.Ref,
  text: string,
  generation: number,
  abort: AbortSignal,
  verify: () => void,
  operation: BrowserPaneOperation,
) {
  throwIfAborted(abort)
  const node = resolveRef(page, ref)
  const response = await debuggerCommand(
    page,
    "Runtime.callFunctionOn",
    {
      objectId: node.objectID,
      functionDeclaration: browserFillFunction,
      arguments: [{ value: node.token }],
      returnByValue: true,
    },
    abort,
    operation,
  )
  const editable = readRuntimeValue(response)
  verify()
  assertDocument(page, generation)
  if (editable !== true) {
    throw browserError("stale_ref", "The browser element is not editable. Call browser_snapshot again.")
  }
  const modifiers = process.platform === "darwin" ? 4 : 2
  const assert = () => {
    verify()
    assertDocument(page, generation)
  }
  await runBrowserInputPair({
    assert,
    press: () =>
      debuggerCommand(
        page,
        "Input.dispatchKeyEvent",
        { type: "keyDown", key: "a", code: "KeyA", modifiers },
        abort,
        operation,
      ).then(() => undefined),
    release: () =>
      debuggerCommand(
        page,
        "Input.dispatchKeyEvent",
        { type: "keyUp", key: "a", code: "KeyA", modifiers },
        undefined,
        operation,
      ).then(() => undefined),
  })
  await runBrowserInputPair({
    assert,
    press: () =>
      debuggerCommand(
        page,
        "Input.dispatchKeyEvent",
        { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
        abort,
        operation,
      ).then(() => undefined),
    release: () =>
      debuggerCommand(
        page,
        "Input.dispatchKeyEvent",
        { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
        undefined,
        operation,
      ).then(() => undefined),
  })
  await debuggerCommand(page, "Input.insertText", { text }, abort, operation)
  verify()
}

async function press(
  page: Page,
  key: Browser.Key,
  generation: number,
  abort: AbortSignal,
  verify: () => void,
  operation: BrowserPaneOperation,
) {
  throwIfAborted(abort)
  assertDocument(page, generation)
  const info = keyInfo(key)
  await runBrowserInputPair({
    assert: () => {
      verify()
      assertDocument(page, generation)
    },
    press: () =>
      debuggerCommand(page, "Input.dispatchKeyEvent", { type: "keyDown", ...info }, abort, operation).then(
        () => undefined,
      ),
    release: () =>
      debuggerCommand(page, "Input.dispatchKeyEvent", { type: "keyUp", ...info }, undefined, operation).then(
        () => undefined,
      ),
  })
}

async function scroll(
  page: Page,
  direction: Browser.Direction,
  pixels: number,
  generation: number,
  abort: AbortSignal,
  verify: () => void,
  operation: BrowserPaneOperation,
) {
  throwIfAborted(abort)
  assertDocument(page, generation)
  const bounds = page.view.getBounds()
  const distance = Math.min(2_000, Math.max(1, pixels))
  await debuggerCommand(
    page,
    "Input.dispatchMouseEvent",
    {
      type: "mouseWheel",
      x: Math.max(0, Math.round(bounds.width / 2)),
      y: Math.max(0, Math.round(bounds.height / 2)),
      deltaX: direction === "left" ? -distance : direction === "right" ? distance : 0,
      deltaY: direction === "up" ? -distance : direction === "down" ? distance : 0,
    },
    abort,
    operation,
  )
  verify()
}

async function screenshot(
  page: Page,
  generation: number,
  abort: AbortSignal,
  verify: () => void,
  operation: BrowserPaneOperation,
  refresh: () => BrowserPaneState,
): Promise<Browser.Result> {
  throwIfAborted(abort)
  const source = await boundedBrowserOperation(
    () => startBrowserPaneOperation(operation, () => page.view.webContents.capturePage()),
    {
      signal: abort,
      timeout: debuggerCommandTimeout,
      aborted: () => browserError("aborted", "The browser screenshot was aborted."),
      timedOut: () => browserError("timeout", "The browser screenshot timed out."),
    },
  )
  verify()
  throwIfAborted(abort)
  assertDocument(page, generation)
  const size = source.getSize()
  const scale = Math.min(1, 2_000 / Math.max(size.width, size.height))
  const image =
    scale < 1
      ? source.resize({
          width: Math.round(size.width * scale),
          height: Math.round(size.height * scale),
          quality: "good",
        })
      : source
  const output = image.toPNG()
  if (output.byteLength > 5 * 1_024 * 1_024) {
    throw browserError("result_too_large", "The browser screenshot exceeds 5 MiB.")
  }
  const dimensions = image.getSize()
  if (dimensions.width < 1 || dimensions.height < 1) {
    throw browserError("internal", "The browser pane has no drawable area.")
  }
  assertDocument(page, generation)
  verify()
  const state = refreshedState(page, refresh, verify)
  return {
    type: "screenshot",
    state,
    mediaType: "image/png",
    data: new Uint8Array(output),
    width: dimensions.width,
    height: dimensions.height,
  }
}

function resolveRef(page: Page, ref: Browser.Ref) {
  const node = page.refs.get(normalizeBrowserRef(ref))
  if (!node || node.snapshot !== page.snapshot) {
    throw browserError("stale_ref", "The element reference is stale. Call browser_snapshot again.")
  }
  return node
}

function navigateHistory(page: Page, offset: -1 | 1, operation: BrowserPaneOperation) {
  const history = page.view.webContents.navigationHistory
  if (!history.canGoToOffset(offset)) return
  const origin = browserHistoryDestinationOrigin(history, offset)
  if (origin === undefined) throw browserError("invalid_url", "The browser history destination is not allowed.")
  page.approvedOrigin = origin
  operation.started = true
  history.goToOffset(offset)
}

async function debuggerCommand(
  page: Page,
  method: string,
  params: Record<string, unknown> | undefined,
  abort: AbortSignal | undefined,
  operation: BrowserPaneOperation,
) {
  throwIfAborted(abort)
  if (page.closed || page.view.webContents.isDestroyed()) {
    throw browserError("page_crashed", "The browser page is no longer available.")
  }
  const api = page.view.webContents.debugger
  if (!api.isAttached()) {
    operation.started = true
    api.attach("1.3")
  }
  return boundedBrowserOperation(() => startBrowserPaneOperation(operation, () => api.sendCommand(method, params)), {
    signal: abort,
    timeout: debuggerCommandTimeout,
    aborted: () => browserError("aborted", "The browser action was aborted."),
    timedOut: () => browserError("timeout", "The browser command timed out."),
  }).catch((error) => {
    const stale = browserProtocolError(error)
    if (stale) throw browserError("stale_ref", stale.message)
    throw error
  })
}

function readSnapshot(input: unknown) {
  const value = readRuntimeValue(input)
  if (
    !record(value) ||
    !Array.isArray(value.nodes) ||
    !Number.isSafeInteger(value.nextRef) ||
    Number(value.nextRef) < 0
  ) {
    throw browserError("internal", "Invalid browser snapshot response.")
  }
  if (value.nodes.length > browserSnapshotLimit || !value.nodes.every(snapshotNode)) {
    throw browserError("internal", "Invalid browser snapshot nodes.")
  }
  return { nodes: value.nodes, nextRef: Number(value.nextRef) }
}

function snapshotNode(input: unknown): input is SnapshotNode {
  if (!record(input)) return false
  if (
    typeof input.role !== "string" ||
    !/^[a-zA-Z0-9_-]+$/.test(input.role) ||
    input.role.length > 40 ||
    typeof input.name !== "string" ||
    input.name.length > 300 ||
    typeof input.value !== "string" ||
    input.value.length > 300 ||
    !Number.isSafeInteger(input.depth) ||
    Number(input.depth) < 0 ||
    Number(input.depth) > 6
  )
    return false
  if (input.token !== undefined && (typeof input.token !== "string" || !/^e[1-9][0-9]*$/.test(input.token))) {
    return false
  }
  if (input.expanded !== undefined && typeof input.expanded !== "boolean") return false
  return [input.checked, input.disabled, input.selected].every(
    (property) => property === undefined || typeof property === "boolean",
  )
}

function readRuntimeObjectID(input: unknown) {
  if (!record(input) || !record(input.result) || typeof input.result.objectId !== "string") {
    throw browserError("internal", "Invalid browser runtime object.")
  }
  return input.result.objectId
}

function readRuntimeValue(input: unknown) {
  if (!record(input)) throw browserError("internal", "Browser page operation failed.")
  if (input.exceptionDetails !== undefined) {
    const details = record(input.exceptionDetails) ? input.exceptionDetails : undefined
    const exception = details && record(details.exception) ? details.exception : undefined
    const message =
      (exception && typeof exception.description === "string" && exception.description) ||
      (details && typeof details.text === "string" && details.text) ||
      "Browser page operation failed."
    const stale = browserProtocolError(message)
    if (stale) throw browserError("stale_ref", stale.message)
    throw browserError("internal", message)
  }
  if (!record(input.result) || !("value" in input.result)) {
    throw browserError("internal", "Browser page operation failed.")
  }
  return input.result.value
}

function readPoint(input: unknown) {
  const value = readRuntimeValue(input)
  if (
    !record(value) ||
    typeof value.x !== "number" ||
    !Number.isFinite(value.x) ||
    typeof value.y !== "number" ||
    !Number.isFinite(value.y)
  ) {
    throw browserError("stale_ref", "The browser element has no clickable bounds.")
  }
  return { x: value.x, y: value.y }
}

function keyInfo(key: Browser.Key) {
  const value = key === "Space" ? " " : key
  const code = key === "Space" ? "Space" : key
  const windowsVirtualKeyCode =
    key === "Enter"
      ? 13
      : key === "Tab"
        ? 9
        : key === "Escape"
          ? 27
          : key === "Backspace"
            ? 8
            : key === "Delete"
              ? 46
              : key === "Space"
                ? 32
                : undefined
  return { key: value, code, ...(windowsVirtualKeyCode ? { windowsVirtualKeyCode } : {}) }
}

function contractState(state: BrowserPaneState, generation: number): Browser.State {
  return {
    url: state.url.slice(0, 16_384),
    title: state.title.slice(0, 1_024),
    loading: state.loading,
    canGoBack: state.canGoBack,
    canGoForward: state.canGoForward,
    generation,
  }
}

function refreshedState(page: Page, refresh: () => BrowserPaneState, verify: () => void) {
  const state = contractState(refresh(), page.document)
  verify()
  return state
}

function enqueue<Result>(entry: Entry, run: () => Promise<Result>) {
  const result = entry.queue.then(run, run)
  entry.queue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

function assertActive(entry: Entry, claim: BrowserPaneClaim<Page>, epoch: string, abort?: AbortSignal) {
  throwIfAborted(abort)
  if (claim.leaseID !== epoch || !entry.lifecycle.isCurrent(claim)) {
    throw browserError("not_attached", "The browser pane operation is no longer current.")
  }
}

function assertDriverActive(entry: Entry, page: Page, identity: BrowserPaneIdentity, abort: AbortSignal) {
  throwIfAborted(abort)
  if (!ownsDesiredPage(entry, page, identity)) {
    throw browserError("not_attached", "The browser pane is no longer attached to this server Session.")
  }
}

function cancelEntry(entry: Entry) {
  entry.active?.controller.abort()
  entry.active = undefined
  entry.requests.forEach((request) => request.abort())
  entry.requests.clear()
  const page = entry.lifecycle.state()?.context
  if (!page) return
  invalidateRefs(page)
  if (!page.view.webContents.isDestroyed()) page.view.webContents.stop()
  void page.session.closeAllConnections().catch(() => undefined)
}

function invalidateRefs(page: Page) {
  const objectID = page.snapshotObjectID
  page.snapshotObjectID = undefined
  invalidateBrowserRefs(page)
  if (objectID) releaseSnapshotObject(page, objectID)
}

function releaseSnapshotObject(page: Page, objectID: string) {
  if (page.closed || page.view.webContents.isDestroyed()) return
  const api = page.view.webContents.debugger
  if (!api.isAttached()) return
  void api.sendCommand("Runtime.releaseObject", { objectId: objectID }).catch(() => undefined)
}

async function active<Result>(entry: Entry, controller: AbortController, page: Page, run: () => Promise<Result>) {
  const operation = { controller, page }
  entry.active = operation
  try {
    return await run()
  } finally {
    if (entry.active === operation) entry.active = undefined
  }
}

function detach(entry: Entry, identity?: BrowserPaneIdentity) {
  const state = entry.lifecycle.state()
  const owner = state ?? entry.desired?.identity
  if (!owner || (identity && !sameBrowserPaneIdentity(owner, identity))) return false
  cancelEntry(entry)
  hideEntry(entry)
  entry.desired = undefined
  entry.lifecycle.release(identity)
  return true
}

function ownsIdentity(entry: Entry, identity: BrowserPaneIdentity) {
  const owner = entry.lifecycle.state() ?? entry.desired?.identity
  return owner ? sameBrowserPaneIdentity(owner, identity) : false
}

function ownsDesiredPage(entry: Entry, page: Page, identity: BrowserPaneIdentity) {
  const owner = entry.lifecycle.state()
  return (
    !entry.disposed &&
    !page.closed &&
    owner?.context === page &&
    sameBrowserPaneIdentity(owner, identity) &&
    !!entry.desired &&
    sameBrowserPaneIdentity(entry.desired.identity, identity)
  )
}

function hideEntry(entry: Entry) {
  entry.lifecycle.state()?.context.view.setVisible(false)
  entry.masks.forEach((mask) => mask.setVisible(false))
}

function assertDocument(page: Page, generation: number) {
  if (page.document !== generation) {
    throw browserError("stale_ref", "The browser page changed. Call browser_snapshot again.")
  }
}

function throwIfAborted(abort?: AbortSignal) {
  if (abort?.aborted) throw browserError("aborted", "The browser action was aborted.")
}

function browserError(code: Browser.ErrorCode, message: string) {
  return new BrowserPaneError(code, message.slice(0, 1_024))
}

function normalizeBrowserError(error: unknown) {
  if (error instanceof BrowserPaneError) return error
  return browserError("internal", error instanceof Error ? error.message : String(error))
}

function readIdentity(input: {
  readonly serverKey?: string
  readonly sessionID?: string
  readonly bindingID?: string
  readonly endpointRevision?: number
}) {
  const endpointRevision = input.endpointRevision
  if (
    !input.serverKey ||
    !input.sessionID ||
    !input.bindingID ||
    typeof endpointRevision !== "number" ||
    !Number.isSafeInteger(endpointRevision) ||
    endpointRevision < 0
  )
    return undefined
  return {
    serverKey: input.serverKey,
    sessionID: input.sessionID,
    bindingID: input.bindingID,
    endpointRevision,
  }
}

function requireIdentity(input: {
  readonly serverKey?: string
  readonly sessionID?: string
  readonly bindingID?: string
  readonly endpointRevision?: number
}): BrowserPaneIdentity {
  const identity = readIdentity(input)
  if (!identity) throw browserError("protocol", "Browser pane attachment identity is incomplete.")
  return identity
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
