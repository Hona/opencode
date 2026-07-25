import { randomUUID } from "node:crypto"
import { DesktopBrowser } from "@opencode-ai/core/desktop-browser"
import { BrowserWindow, View, WebContentsView } from "electron"
import type { BrowserPaneCommand, BrowserPaneLayout, BrowserPaneState } from "../preload/types"
import {
  allowedBrowserURL,
  boundedBrowserOperation,
  browserBottomMasks,
  browserPartition,
  browserProtocolError,
  browserRef,
  invalidateBrowserRefs,
  normalizeBrowserBounds,
  normalizeBrowserRef,
  normalizeBrowserURL,
  runBrowserInputPair,
  stopBrowserOperation,
} from "./browser-pane-policy"
import {
  createBrowserPaneLifecycle,
  fenceBrowserPaneOperation,
  startBrowserPaneOperation,
  SupersededError,
  type BrowserPaneClaim,
  type BrowserPaneLifecycle,
  type BrowserPaneOperation,
} from "./browser-pane-lifecycle"

type Ref = { snapshot: number; backendNodeID: number }
type Page = {
  win: BrowserWindow
  view: WebContentsView
  document: number
  snapshot: number
  refs: Map<string, Ref>
  crashed: boolean
  closed: boolean
  cleanups: (() => void)[]
  state: BrowserPaneState
}
type Entry = {
  win: BrowserWindow
  masks: View[]
  lifecycle: BrowserPaneLifecycle<Page>
  desired?: BrowserPaneLayout
  disposed: boolean
  cleanups: (() => void)[]
  requests: Set<AbortController>
  active?: { controller: AbortController; context: Page }
  state: BrowserPaneState
  queue: Promise<void>
}

type AXNode = {
  nodeId?: string
  parentId?: string
  backendDOMNodeId?: number
  ignored?: boolean
  role?: { value?: unknown }
  name?: { value?: unknown }
  value?: { value?: unknown }
  properties?: { name?: unknown; value?: { value?: unknown } }[]
}

const interactiveRoles = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "menuitem",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
])
const readableRoles = new Set([
  "article",
  "cell",
  "heading",
  "image",
  "list",
  "listitem",
  "paragraph",
  "region",
  "row",
  "StaticText",
])
const debuggerCommandTimeout = 10_000

export function createBrowserPaneController() {
  const entries = new Map<number, Entry>()
  const listeners = new Set<(state: DesktopBrowser.AttachmentState) => void>()

  const publishAttachments = () => {
    const state: DesktopBrowser.AttachmentState = {
      type: "desktop.browser.state",
      version: DesktopBrowser.VERSION,
      attachments: [...entries.values()].flatMap((entry) => {
        const claim = entry.lifecycle.current()
        if (!claim) return []
        return [
          {
            sessionID: claim.sessionID,
            lease: claim.lease,
            state: contractState(claim.context.state, claim.context.document),
          },
        ]
      }),
    }
    listeners.forEach((listener) => listener(state))
  }

  const publish = (entry: Entry, page?: Page, error?: string) => {
    if (page && !entry.lifecycle.owns(page)) return entry.state
    const contents = page?.view.webContents
    const state = contents
      ? {
          url: contents.getURL(),
          title: contents.getTitle(),
          loading: contents.isLoading(),
          canGoBack: contents.navigationHistory.canGoBack(),
          canGoForward: contents.navigationHistory.canGoForward(),
          ...(error ? { error } : {}),
        }
      : { ...entry.state, loading: false, ...(error ? { error } : {}) }
    if (page) page.state = state
    entry.state = state
    if (!entry.win.isDestroyed()) entry.win.webContents.send("browser-pane-state", state)
    publishAttachments()
    return state
  }

  const disposePage = (page: Page) => {
    if (page.closed) return
    page.closed = true
    const contents = page.view.webContents
    const browserSession = contents.session
    try {
      page.cleanups.splice(0).forEach((cleanup) => {
        try {
          cleanup()
        } catch {}
      })
      browserSession.setPermissionRequestHandler(null)
      browserSession.setPermissionCheckHandler(null)
      browserSession.setDevicePermissionHandler(null)
      browserSession.setDisplayMediaRequestHandler(null)
    } finally {
      if (!page.win.isDestroyed()) page.win.contentView.removeChildView(page.view)
      if (!contents.isDestroyed()) contents.close()
    }
  }

  const createPage = (win: BrowserWindow) => {
    const view = new WebContentsView({
      webPreferences: {
        partition: browserPartition(randomUUID()),
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
        navigateOnDragDrop: false,
        autoplayPolicy: "document-user-activation-required",
        focusOnNavigation: false,
        disableDialogs: true,
        devTools: false,
      },
    })
    view.setVisible(false)
    view.setBorderRadius(0)
    view.setBackgroundColor("#ffffff")
    win.contentView.addChildView(view)
    const page: Page = {
      win,
      view,
      document: 0,
      snapshot: 0,
      refs: new Map(),
      crashed: false,
      closed: false,
      cleanups: [],
      state: { url: "", title: "", loading: false, canGoBack: false, canGoForward: false },
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

    const preventUnsafeNavigation = (event: Electron.Event<{ url: string }>) => {
      if (allowedBrowserURL(event.url)) return
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
    const onStartNavigation = (_event: Electron.Event, url: string, _inPlace: boolean, isMainFrame: boolean) => {
      if (!isMainFrame) return
      const entry = entries.get(win.id)
      if (!entry?.lifecycle.owns(page)) return
      page.crashed = false
      page.document++
      invalidateBrowserRefs(page)
      page.state = { ...page.state, url, loading: true }
      entry.state = page.state
      publishAttachments()
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

    const replaceCrashedPage = (message: string) => {
      const entry = entries.get(win.id)
      if (entry) replacePage(entry, page, message)
    }
    const onRenderGone = () => replaceCrashedPage("The browser page crashed")
    contents.on("render-process-gone", onRenderGone)
    page.cleanups.push(() => contents.off("render-process-gone", onRenderGone))
    const onDebuggerDetach = () => replaceCrashedPage("The browser debugger detached")
    contents.debugger.on("detach", onDebuggerDetach)
    page.cleanups.push(() => contents.debugger.off("detach", onDebuggerDetach))

    return { context: page, ready: contents.loadURL("about:blank") }
  }

  const create = (win: BrowserWindow) => {
    const masks = Array.from({ length: 8 }, () => new View())
    for (const mask of masks) {
      mask.setVisible(false)
      win.contentView.addChildView(mask)
    }
    const entry: Entry = {
      win,
      masks,
      lifecycle: createBrowserPaneLifecycle({
        create: () => createPage(win),
        close: disposePage,
        lease: randomUUID,
      }),
      disposed: false,
      cleanups: [],
      requests: new Set(),
      state: emptyState(),
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

  const setLayout = (win: BrowserWindow, layout: BrowserPaneLayout) => {
    const entry = entries.get(win.id)
    if (layout.destroy) {
      // Enablement is still renderer-owned in this local draft, so one disable must revoke every main-owned attachment.
      dispose()
      return
    }
    if (!layout.attached || !layout.sessionID) {
      const owner = entry?.lifecycle.state()?.sessionID ?? entry?.desired?.sessionID
      if (entry && layout.sessionID && owner !== layout.sessionID) return
      if (entry) detachEntry(entry, layout.sessionID)
      return
    }

    const next = entry ?? create(win)
    const owner = [...entries.values()].find(
      (item) => item !== next && item.lifecycle.state()?.sessionID === layout.sessionID,
    )
    if (owner) {
      detachEntry(next)
      publish(next, undefined, "Browser tools for this session are attached in another window")
      return
    }
    next.desired = layout
    const state = next.lifecycle.state()
    if (state?.sessionID !== layout.sessionID) {
      beginAttachment(next, layout)
      return
    }
    const claim = next.lifecycle.current()
    if (!claim) {
      hideEntry(next)
      return
    }
    applyLayout(next, claim, layout)
  }

  const applyLayout = (entry: Entry, claim: BrowserPaneClaim<Page>, layout: BrowserPaneLayout) => {
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
    const masks = browserBottomMasks(bounds)
    entry.masks.forEach((mask, index) => {
      const maskBounds = masks[index]
      if (!maskBounds) {
        mask.setVisible(false)
        return
      }
      mask.setBackgroundColor(layout.background ?? "#000000")
      mask.setBounds(maskBounds)
      mask.setVisible(true)
    })
  }

  const beginAttachment = (entry: Entry, layout: BrowserPaneLayout) => {
    if (!layout.sessionID) return
    cancelEntry(entry)
    entry.desired = layout
    const pending = entry.lifecycle.claim(layout.sessionID)
    hideEntry(entry)
    publishAttachments()
    void pending.then(
      (claim) => {
        if (!entry.lifecycle.isCurrent(claim)) return
        const desired = entry.desired
        if (!desired?.attached || desired.sessionID !== claim.sessionID) {
          entry.lifecycle.release(claim.sessionID)
          return
        }
        publish(entry, claim.context)
        applyLayout(entry, claim, desired)
      },
      (error) => {
        if (error instanceof SupersededError) return
        const desired = entry.desired
        if (!desired?.attached || desired.sessionID !== layout.sessionID) return
        publish(entry, undefined, error instanceof Error ? error.message : String(error))
      },
    )
  }

  const replacePage = (entry: Entry, page: Page, message: string) => {
    if (!entry.lifecycle.owns(page)) return
    cancelEntry(entry)
    page.crashed = true
    page.document++
    invalidateBrowserRefs(page)
    const sessionID = entry.lifecycle.crash(page)
    publish(entry, undefined, message)
    publishAttachments()
    const desired = entry.desired
    if (!sessionID || !desired?.attached || desired.sessionID !== sessionID) return
    beginAttachment(entry, desired)
  }

  const command = async (win: BrowserWindow, input: BrowserPaneCommand) => {
    const entry = entries.get(win.id)
    const claim = entry?.lifecycle.current()
    if (!entry || !claim) throw new Error("Open the Browser pane before using browser controls")
    if (input.type === "stop") {
      const running = entry.active
      stopBrowserOperation({
        active: running?.controller,
        stop: () => (running?.context ?? claim.context).view.webContents.stop(),
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
            throwIfAborted(controller.signal)
            if (!entry.lifecycle.isCurrent(claim)) {
              throw browserError("not_attached", "The browser pane changed before the command could run.", true)
            }
            switch (input.type) {
              case "navigate":
                await navigate(entry, claim.context, input.url, controller.signal, undefined, operation)
                return
              case "back":
                if (claim.context.view.webContents.navigationHistory.canGoBack())
                  claim.context.view.webContents.navigationHistory.goBack()
                return
              case "forward":
                if (claim.context.view.webContents.navigationHistory.canGoForward())
                  claim.context.view.webContents.navigationHistory.goForward()
                return
              case "reload":
                claim.context.view.webContents.reload()
                return
            }
          }),
        replace: (page) => replacePage(entry, page, "The browser context restarted after an interrupted operation"),
      }),
    ).finally(() => entry.requests.delete(controller))
  }

  const state = (win: BrowserWindow) => entries.get(win.id)?.state ?? emptyState()

  const request = async (input: DesktopBrowser.Request, abort?: AbortSignal): Promise<DesktopBrowser.Result> => {
    const matches = [...entries.values()].flatMap((entry) => {
      const claim = entry.lifecycle.current()
      return claim?.sessionID === input.sessionID ? [{ entry, claim }] : []
    })
    const command = input.command
    if (command.type === "status") {
      const match = input.lease
        ? matches.find((item) => item.claim.lease === input.lease)
        : matches.length === 1
          ? matches[0]
          : undefined
      if (!match) return { type: "status", attached: false }
      return {
        type: "status",
        attached: true,
        lease: match.claim.lease,
        state: contractState(publish(match.entry, match.claim.context), match.claim.context.document),
      }
    }
    const match = matches.find((item) => item.claim.lease === input.lease)
    if (!match)
      throw browserError("not_attached", "The browser pane lease is no longer attached to this session.", true)
    if (matches.length > 1)
      throw browserError("internal", "More than one browser pane is attached to this session.", false)
    const entry = match.entry
    const claim = match.claim
    const controller = new AbortController()
    const operation = { started: false }
    const onAbort = () => controller.abort()
    abort?.addEventListener("abort", onAbort, { once: true })
    entry.requests.add(controller)
    return enqueue(entry, () =>
      fenceBrowserPaneOperation({
        operation,
        context: claim.context,
        run: () =>
          active(entry, controller, claim.context, async () => {
            const verify = () => assertActive(entry, claim, controller.signal)
            verify()
            return execute(entry, claim.context, command, controller.signal, verify, operation)
          }),
        replace: (page) => replacePage(entry, page, "The browser context restarted after an interrupted operation"),
      }),
    ).finally(() => {
      abort?.removeEventListener("abort", onAbort)
      entry.requests.delete(controller)
    })
  }

  const dispose = () => {
    for (const entry of entries.values()) disposeEntry(entry)
    entries.clear()
    publishAttachments()
  }

  const subscribe = (listener: (state: DesktopBrowser.AttachmentState) => void) => {
    listeners.add(listener)
    publishAttachments()
    return () => listeners.delete(listener)
  }

  const detachEntry = (entry: Entry, sessionID?: string) => {
    detach(entry, sessionID)
    publishAttachments()
  }

  function disposeEntry(entry: Entry) {
    if (entry.disposed) return
    entry.disposed = true
    if (entries.get(entry.win.id) === entry) entries.delete(entry.win.id)
    cancelEntry(entry)
    entry.desired = undefined
    entry.lifecycle.dispose()
    entry.cleanups.splice(0).forEach((cleanup) => cleanup())
    if (!entry.win.isDestroyed()) {
      for (const mask of entry.masks) entry.win.contentView.removeChildView(mask)
    }
    publishAttachments()
  }

  return { setLayout, command, state, request, subscribe, dispose }
}

export type BrowserPaneController = ReturnType<typeof createBrowserPaneController>

async function execute(
  entry: Entry,
  page: Page,
  command: Exclude<DesktopBrowser.Command, { type: "status" }>,
  abort: AbortSignal,
  verify: () => void,
  operation: BrowserPaneOperation,
) {
  throwIfAborted(abort)
  assertDocument(page, command.generation)
  if (page.crashed && command.type !== "navigate") {
    throw browserError("page_crashed", "The browser page crashed. Navigate or reload it and retry.", true)
  }
  switch (command.type) {
    case "navigate":
      await navigate(entry, page, command.url, abort, verify, operation)
      return { type: "action" as const, state: contractState(page.state, page.document) }
    case "snapshot":
      return snapshot(entry, page, command.generation, abort, verify, operation)
    case "click":
      await click(page, command.ref, command.generation, abort, verify, operation)
      return { type: "action" as const, state: contractState(publishState(entry, page), page.document) }
    case "fill":
      await fill(page, command.ref, command.text, command.generation, abort, verify, operation)
      return { type: "action" as const, state: contractState(publishState(entry, page), page.document) }
    case "press":
      await press(page, command.key, command.generation, abort, verify, operation)
      return { type: "action" as const, state: contractState(publishState(entry, page), page.document) }
    case "scroll":
      await scroll(page, command.direction, command.amount, command.generation, abort, verify, operation)
      return { type: "action" as const, state: contractState(publishState(entry, page), page.document) }
    case "screenshot":
      return screenshot(entry, page, command.generation, abort, verify, operation)
  }
  throw new Error("Unsupported browser command")
}

async function navigate(
  entry: Entry,
  page: Page,
  input: string,
  abort: AbortSignal | undefined,
  verify: (() => void) | undefined,
  operation: BrowserPaneOperation,
) {
  const url = normalizeBrowserURL(input)
  if (!allowedBrowserURL(url)) {
    throw browserError("invalid_url", "Only HTTP, HTTPS, and file URLs are supported.", false)
  }
  throwIfAborted(abort)
  const onAbort = () => page.view.webContents.stop()
  abort?.addEventListener("abort", onAbort, { once: true })
  await boundedBrowserOperation(() => startBrowserPaneOperation(operation, () => page.view.webContents.loadURL(url)), {
    signal: abort,
    timeout: 30_000,
    aborted: () => browserError("aborted", "The browser navigation was aborted.", true),
    timedOut: () => {
      page.view.webContents.stop()
      return browserError("timeout", "The browser navigation timed out.", true)
    },
  })
    .catch((error) => {
      if (abort?.aborted) throw browserError("aborted", "The browser navigation was aborted.", true)
      if (error instanceof Error && "code" in error) throw error
      throw browserError("navigation_failed", String(error), true)
    })
    .finally(() => abort?.removeEventListener("abort", onAbort))
  throwIfAborted(abort)
  verify?.()
  publishState(entry, page)
}

async function snapshot(
  entry: Entry,
  page: Page,
  generation: number,
  abort: AbortSignal,
  verify: () => void,
  operation: BrowserPaneOperation,
): Promise<DesktopBrowser.Result> {
  throwIfAborted(abort)
  await debuggerCommand(page, "Accessibility.enable", undefined, abort, operation)
  const response = await debuggerCommand(page, "Accessibility.getFullAXTree", undefined, abort, operation)
  verify?.()
  throwIfAborted(abort)
  assertDocument(page, generation)
  const nodes = readAXNodes(response).slice(0, 500)
  const parents = new Map(nodes.flatMap((node) => (node.nodeId ? [[node.nodeId, node.parentId] as const] : [])))
  const depth = (node: AXNode) => {
    let current = node.parentId
    let value = 0
    while (current && value < 6) {
      value++
      current = parents.get(current)
    }
    return value
  }

  invalidateBrowserRefs(page)
  let index = 0
  const lines = nodes.flatMap((node) => {
    if (node.ignored) return []
    const role = axString(node.role) || "node"
    const name = axString(node.name)
    const value = axString(node.value)
    const focusable = node.properties?.some(
      (property) => property.name === "focusable" && property.value?.value === true,
    )
    const interactive = interactiveRoles.has(role) || focusable
    if (!interactive && !readableRoles.has(role)) return []
    if (!interactive && !name && !value) return []
    const ref =
      interactive && typeof node.backendDOMNodeId === "number" ? browserRef(page.snapshot, ++index) : undefined
    if (ref && node.backendDOMNodeId) {
      page.refs.set(ref, { snapshot: page.snapshot, backendNodeID: node.backendDOMNodeId })
    }
    const properties = node.properties?.flatMap((property) => {
      const name = String(property.name)
      if (!["checked", "disabled", "expanded", "selected"].includes(name)) return []
      return [`${name}=${String(property.value?.value)}`]
    })
    const detail = [
      name ? JSON.stringify(name) : undefined,
      value && value !== name ? `value=${JSON.stringify(value)}` : undefined,
    ]
      .filter(Boolean)
      .join(" ")
    return [
      `${"  ".repeat(depth(node))}${ref ? `${ref} ` : ""}[${role}]${detail ? ` ${detail}` : ""}${properties?.length ? ` ${properties.join(" ")}` : ""}`,
    ]
  })
  const content = [`Page: ${page.view.webContents.getTitle()}`, `URL: ${page.view.webContents.getURL()}`, "", ...lines]
    .join("\n")
    .slice(0, 40 * 1024)
  assertDocument(page, generation)
  verify?.()
  return { type: "snapshot", state: contractState(publishState(entry, page), page.document), content }
}

async function click(
  page: Page,
  ref: string,
  generation: number,
  abort: AbortSignal,
  verify: () => void,
  operation: BrowserPaneOperation,
) {
  const node = resolveRef(page, ref)
  await debuggerCommand(page, "DOM.scrollIntoViewIfNeeded", { backendNodeId: node.backendNodeID }, abort, operation)
  verify()
  assertDocument(page, generation)
  const response = await debuggerCommand(
    page,
    "DOM.getBoxModel",
    { backendNodeId: node.backendNodeID },
    abort,
    operation,
  )
  verify()
  const quad = readBoxQuad(response)
  const point = {
    x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
    y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4,
  }
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
        {
          type: "mouseReleased",
          button: "left",
          clickCount: 1,
          ...point,
        },
        undefined,
        operation,
      ).then(() => undefined),
  })
}

async function fill(
  page: Page,
  ref: string,
  text: string,
  generation: number,
  abort: AbortSignal,
  verify: () => void,
  operation: BrowserPaneOperation,
) {
  if (text.length > 10_000)
    throw browserError("result_too_large", "Browser fill text exceeds 10,000 characters.", false)
  throwIfAborted(abort)
  const node = resolveRef(page, ref)
  await debuggerCommand(page, "DOM.focus", { backendNodeId: node.backendNodeID }, abort, operation)
  verify()
  assertDocument(page, generation)
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
        {
          type: "keyUp",
          key: "Backspace",
          code: "Backspace",
          windowsVirtualKeyCode: 8,
        },
        undefined,
        operation,
      ).then(() => undefined),
  })
  await debuggerCommand(page, "Input.insertText", { text }, abort, operation)
  verify()
}

async function press(
  page: Page,
  key: Extract<DesktopBrowser.Command, { type: "press" }>["key"],
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
  direction: Extract<DesktopBrowser.Command, { type: "scroll" }>["direction"],
  amount: number,
  generation: number,
  abort: AbortSignal,
  verify: () => void,
  operation: BrowserPaneOperation,
) {
  throwIfAborted(abort)
  assertDocument(page, generation)
  const bounds = page.view.getBounds()
  const distance = Math.min(2000, Math.max(1, amount))
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
  entry: Entry,
  page: Page,
  generation: number,
  abort: AbortSignal,
  verify: () => void,
  operation: BrowserPaneOperation,
): Promise<DesktopBrowser.Result> {
  throwIfAborted(abort)
  const source = await boundedBrowserOperation(
    () => startBrowserPaneOperation(operation, () => page.view.webContents.capturePage()),
    {
      signal: abort,
      timeout: debuggerCommandTimeout,
      aborted: () => browserError("aborted", "The browser screenshot was aborted.", true),
      timedOut: () => browserError("timeout", "The browser screenshot timed out.", true),
    },
  )
  verify?.()
  throwIfAborted(abort)
  assertDocument(page, generation)
  verify?.()
  const size = source.getSize()
  const scale = Math.min(1, 2000 / Math.max(size.width, size.height))
  const image =
    scale < 1
      ? source.resize({
          width: Math.round(size.width * scale),
          height: Math.round(size.height * scale),
          quality: "good",
        })
      : source
  const output = image.toPNG()
  if (output.byteLength > 5 * 1024 * 1024) {
    throw browserError("result_too_large", "The browser screenshot exceeds 5 MiB.", false)
  }
  const dimensions = image.getSize()
  assertDocument(page, generation)
  verify?.()
  return {
    type: "screenshot",
    state: contractState(publishState(entry, page), page.document),
    data: output.toString("base64"),
    width: dimensions.width,
    height: dimensions.height,
  }
}

function resolveRef(page: Page, ref: string) {
  const node = page.refs.get(normalizeBrowserRef(ref))
  if (!node || node.snapshot !== page.snapshot) {
    throw browserError("stale_ref", "The element reference is stale. Call browser_snapshot again.", true)
  }
  return node
}

async function debuggerCommand(
  page: Page,
  method: string,
  params: Record<string, unknown> | undefined,
  abort: AbortSignal | undefined,
  operation: BrowserPaneOperation,
) {
  throwIfAborted(abort)
  const api = page.view.webContents.debugger
  if (!api.isAttached()) {
    operation.started = true
    api.attach("1.3")
  }
  return boundedBrowserOperation(() => startBrowserPaneOperation(operation, () => api.sendCommand(method, params)), {
    signal: abort,
    timeout: debuggerCommandTimeout,
    aborted: () => browserError("aborted", "The browser action was aborted.", true),
    timedOut: () => browserError("timeout", "The browser command timed out.", true),
  }).catch((error) => {
    const stale = browserProtocolError(error)
    if (stale) throw stale
    throw error
  })
}

function readAXNodes(input: unknown): AXNode[] {
  if (!record(input) || !Array.isArray(input.nodes)) throw new Error("Invalid accessibility snapshot response")
  return input.nodes.filter(record) as AXNode[]
}

function readBoxQuad(input: unknown) {
  if (!record(input) || !record(input.model)) throw new Error("Invalid DOM.getBoxModel response")
  const quad = input.model.border ?? input.model.content
  if (!Array.isArray(quad) || quad.length < 8 || !quad.every((value) => typeof value === "number")) {
    throw new Error("Browser element has no clickable bounds")
  }
  return quad
}

function axString(input: { value?: unknown } | undefined) {
  if (typeof input?.value === "string") return input.value.replaceAll(/\s+/g, " ").trim()
  if (typeof input?.value === "number" || typeof input?.value === "boolean") return String(input.value)
  return ""
}

function keyInfo(key: Extract<DesktopBrowser.Command, { type: "press" }>["key"]) {
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

function publishState(entry: Entry, page: Page) {
  if (!entry.lifecycle.owns(page)) {
    throw browserError("not_attached", "The browser pane context was replaced.", true)
  }
  const contents = page.view.webContents
  const state = {
    url: contents.getURL(),
    title: contents.getTitle(),
    loading: contents.isLoading(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
  }
  page.state = state
  entry.state = state
  if (!entry.win.isDestroyed()) entry.win.webContents.send("browser-pane-state", state)
  return state
}

function contractState(state: BrowserPaneState, generation: number): DesktopBrowser.State {
  return {
    url: state.url,
    title: state.title,
    loading: state.loading,
    canGoBack: state.canGoBack,
    canGoForward: state.canGoForward,
    generation,
  }
}

function emptyState(): BrowserPaneState {
  return { url: "", title: "", loading: false, canGoBack: false, canGoForward: false }
}

function enqueue<T>(entry: Entry, run: () => Promise<T>) {
  const result = entry.queue.then(run, run)
  entry.queue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

function assertActive(entry: Entry, claim: BrowserPaneClaim<Page>, abort?: AbortSignal) {
  throwIfAborted(abort)
  if (!entry.lifecycle.isCurrent(claim)) {
    throw browserError("not_attached", "The browser pane is no longer attached to this session.", true)
  }
}

function cancelEntry(entry: Entry) {
  entry.active?.controller.abort()
  entry.active = undefined
  for (const request of entry.requests) request.abort()
  entry.requests.clear()
  const page = entry.lifecycle.state()?.context
  if (!page) return
  invalidateBrowserRefs(page)
  if (!page.view.webContents.isDestroyed()) page.view.webContents.stop()
}

async function active<T>(entry: Entry, controller: AbortController, context: Page, run: () => Promise<T>) {
  const operation = { controller, context }
  entry.active = operation
  try {
    return await run()
  } finally {
    if (entry.active === operation) entry.active = undefined
  }
}

function detach(entry: Entry, sessionID?: string) {
  const owner = entry.lifecycle.state()?.sessionID ?? entry.desired?.sessionID
  if (sessionID && owner !== sessionID) return
  cancelEntry(entry)
  entry.desired = undefined
  entry.lifecycle.release(sessionID)
  hideEntry(entry)
}

function hideEntry(entry: Entry) {
  entry.lifecycle.state()?.context.view.setVisible(false)
  for (const mask of entry.masks) mask.setVisible(false)
}

function assertDocument(page: Page, generation: number) {
  if (page.document !== generation) {
    throw browserError("stale_ref", "The browser page changed. Call browser_snapshot again.", true)
  }
}

function throwIfAborted(abort?: AbortSignal) {
  if (abort?.aborted) throw browserError("aborted", "The browser action was aborted.", true)
}

function browserError(code: DesktopBrowser.ErrorCode, message: string, retryable: boolean) {
  return Object.assign(new Error(message), { code, retryable })
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
