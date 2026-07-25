import { randomUUID } from "node:crypto"
import { BrowserControl } from "@opencode-ai/sdk-next/browser-control"
import { BrowserWindow, View, WebContentsView } from "electron"
import type { BrowserPaneCommand, BrowserPaneLayout, BrowserPaneState } from "../preload/types"
import {
  allowedBrowserURL,
  allowedBrowserDestination,
  browserDestinationOrigin,
  browserSnapshotExpression,
  browserSnapshotLimit,
  boundedBrowserOperation,
  browserBottomMasks,
  browserContextPartition,
  browserContextEvictions,
  invalidateBrowserRefs,
  normalizeBrowserBounds,
  normalizeBrowserRef,
  normalizeBrowserURL,
  ownBrowserParentListeners,
  runBrowserInputPair,
  stopBrowserOperation,
} from "./browser-pane-policy"

type Ref = { readonly snapshot: number; readonly token: string; readonly objectID: string }
type Entry = {
  readonly win: BrowserWindow
  readonly contextSessionID: string
  readonly view: WebContentsView
  readonly masks: View[]
  attached: boolean
  sessionID?: string
  lease?: string
  attachment: number
  document: number
  snapshot: number
  nextRef: number
  snapshotObjectID?: string
  approvedOrigin?: string
  readonly refs: Map<string, Ref>
  readonly requests: Set<AbortController>
  active?: AbortController
  state: BrowserPaneState
  queue: Promise<void>
  lastUsed: number
  disposed: boolean
  readonly parentListeners: ReturnType<typeof ownBrowserParentListeners>
}

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

export function createBrowserPaneController() {
  // One retained context per Window+Session prevents cookies/history/page state crossing Session ownership.
  const entries = new Map<number, Entry>()
  const contexts = new Map<number, Map<string, Entry>>()
  const watched = new WeakSet<BrowserWindow>()
  let enabled = false
  let contextUse = 0

  const publish = (entry: Entry, error?: string) => {
    const contents = entry.view.webContents
    const state = {
      url: contents.getURL(),
      title: contents.getTitle(),
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      ...(error ? { error } : {}),
    }
    entry.state = state
    if (!entry.win.isDestroyed()) entry.win.webContents.send("browser-pane-state", state)
    return state
  }

  const create = (win: BrowserWindow, contextSessionID: string) => {
    const view = new WebContentsView({
      webPreferences: {
        partition: `${browserContextPartition(win.id, contextSessionID)}-${randomUUID()}`,
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
        devTools: false,
      },
    })
    view.setVisible(false)
    view.setBorderRadius(0)
    view.setBackgroundColor("#ffffff")
    win.contentView.addChildView(view)
    const masks = Array.from({ length: 8 }, () => new View())
    for (const mask of masks) {
      mask.setVisible(false)
      win.contentView.addChildView(mask)
    }

    const parent = win.webContents
    const parentListeners = ownBrowserParentListeners({
      addNavigation: (listener) => parent.on("did-start-navigation", listener),
      removeNavigation: (listener) => parent.removeListener("did-start-navigation", listener),
      addCrash: (listener) => parent.on("render-process-gone", listener),
      removeCrash: (listener) => parent.removeListener("render-process-gone", listener),
      detach: () => detach(entry),
    })
    const entry: Entry = {
      win,
      contextSessionID,
      view,
      masks,
      attached: false,
      attachment: 0,
      document: 0,
      snapshot: 0,
      nextRef: 0,
      refs: new Map(),
      requests: new Set(),
      state: emptyState(),
      queue: Promise.resolve(),
      lastUsed: ++contextUse,
      disposed: false,
      parentListeners,
    }
    const windowContexts = contexts.get(win.id) ?? new Map<string, Entry>()
    windowContexts.set(contextSessionID, entry)
    contexts.set(win.id, windowContexts)

    const contents = view.webContents
    const browserSession = contents.session
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.setDevicePermissionHandler(() => false)
    browserSession.setDisplayMediaRequestHandler((_request, callback) => callback({}))
    browserSession.on("will-download", (event) => event.preventDefault())

    const preventUnsafeNavigation = (event: Electron.Event<{ url: string }>) => {
      if (allowedBrowserDestination(event.url, entry.approvedOrigin)) return
      event.preventDefault()
      publish(entry, "Navigation was blocked by the browser security policy")
    }
    contents.on("will-navigate", preventUnsafeNavigation)
    contents.on("will-redirect", preventUnsafeNavigation)
    contents.setWindowOpenHandler(() => ({ action: "deny" }))
    contents.on("content-bounds-updated", (event) => event.preventDefault())
    contents.on("did-start-loading", () => publish(entry))
    contents.on("did-stop-loading", () => publish(entry))
    contents.on("did-navigate", () => publish(entry))
    contents.on("did-navigate-in-page", () => publish(entry))
    contents.on("page-title-updated", () => publish(entry))
    contents.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => {
      if (!isMainFrame) return
      entry.document++
      invalidateRefs(entry)
    })
    contents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return
      publish(entry, description)
    })
    contents.on("render-process-gone", () => {
      entry.document++
      invalidateRefs(entry)
      publish(entry, "The browser page crashed")
    })
    contents.debugger.on("detach", () => {
      invalidateRefs(entry)
    })
    if (!watched.has(win)) {
      watched.add(win)
      win.once("closed", () => disposeWindow(win.id))
    }
    void contents.loadURL("about:blank")
    return entry
  }

  const setLayout = (win: BrowserWindow, layout: BrowserPaneLayout) => {
    const entry = entries.get(win.id)
    if (!enabled) {
      if (entry) detach(entry)
      return
    }
    if (layout.destroy) {
      disposeWindow(win.id)
      return
    }
    if (!layout.attached || !layout.sessionID) {
      if (entry && layout.sessionID && entry.sessionID !== layout.sessionID) return
      if (entry) detach(entry)
      return
    }

    if (entry && entry.contextSessionID !== layout.sessionID) {
      detach(entry)
      entries.delete(win.id)
    }
    const next = contexts.get(win.id)?.get(layout.sessionID) ?? create(win, layout.sessionID)
    const owner = [...entries.values()].find(
      (item) => item !== next && item.attached && item.sessionID === layout.sessionID,
    )
    if (owner) {
      detach(next)
      publish(next, "Browser tools for this session are attached in another window")
    }
    if (!owner && (!next.attached || next.sessionID !== layout.sessionID)) {
      cancelEntry(next)
      next.attached = true
      next.sessionID = layout.sessionID
      next.lease = randomUUID()
      entries.set(win.id, next)
    }
    next.lastUsed = ++contextUse
    pruneWindow(win.id)
    if (!layout.visible || !layout.bounds || !next.attached) {
      hideEntry(next)
      return
    }
    const bounds = normalizeBrowserBounds(layout.bounds, win.contentView.getBounds())
    if (!bounds) {
      hideEntry(next)
      return
    }
    next.view.setBounds(bounds)
    next.view.setVisible(true)
    const masks = browserBottomMasks(bounds)
    next.masks.forEach((mask, index) => {
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

  const command = async (win: BrowserWindow, input: BrowserPaneCommand) => {
    const entry = entries.get(win.id)
    if (!entry?.attached) throw new Error("Open the Browser pane before using browser controls")
    if (input.type === "stop") {
      stopBrowserOperation({ active: entry.active, stop: () => entry.view.webContents.stop() })
      return
    }
    return enqueue(entry, async () => {
      const controller = new AbortController()
      return active(entry, controller, async () => {
        switch (input.type) {
          case "navigate":
            await navigate(entry, input.url, controller.signal)
            return
          case "back":
            if (entry.view.webContents.navigationHistory.canGoBack()) entry.view.webContents.navigationHistory.goBack()
            return
          case "forward":
            if (entry.view.webContents.navigationHistory.canGoForward())
              entry.view.webContents.navigationHistory.goForward()
            return
          case "reload":
            entry.view.webContents.reload()
            return
        }
      })
    })
  }

  const state = (win: BrowserWindow) => entries.get(win.id)?.state ?? emptyState()

  const request = async (input: BrowserControl.Request, abort?: AbortSignal): Promise<BrowserControl.Result> => {
    const matches = [...entries.values()].filter((entry) => entry.attached && entry.sessionID === input.sessionID)
    const command = input.command
    if (command.type === "status") {
      const entry = input.lease
        ? matches.find((entry) => entry.lease === input.lease)
        : matches.length === 1
          ? matches[0]
          : undefined
      if (!entry?.lease) return { type: "status", attached: false }
      return {
        type: "status",
        attached: true,
        lease: entry.lease,
        state: contractState(publish(entry), entry.document),
      }
    }
    const entry = matches.find((entry) => entry.lease === input.lease)
    if (!entry)
      throw browserError("not_attached", "The browser pane lease is no longer attached to this session.", true)
    if (matches.length > 1) {
      throw browserError("internal", "More than one browser pane is attached to this session.", false)
    }
    const attachment = entry.attachment
    const lease = entry.lease
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    abort?.addEventListener("abort", onAbort, { once: true })
    entry.requests.add(controller)
    return enqueue(entry, () =>
      active(entry, controller, async () => {
        const verify = () => assertActive(entry, input.sessionID, lease, attachment, controller.signal)
        verify()
        return execute(entry, command, controller.signal, verify)
      }),
    ).finally(() => {
      abort?.removeEventListener("abort", onAbort)
      entry.requests.delete(controller)
    })
  }

  const dispose = () => {
    for (const entries of contexts.values()) for (const entry of entries.values()) disposeEntry(entry)
    entries.clear()
    contexts.clear()
  }

  const setEnabled = (next: boolean) => {
    enabled = next
    if (!enabled) dispose()
  }

  function disposeEntry(entry: Entry) {
    if (entry.disposed) return
    entry.disposed = true
    entry.parentListeners.dispose()
    if (entries.get(entry.win.id) === entry) entries.delete(entry.win.id)
    const windowContexts = contexts.get(entry.win.id)
    windowContexts?.delete(entry.contextSessionID)
    if (windowContexts?.size === 0) contexts.delete(entry.win.id)
    cancelEntry(entry)
    if (!entry.win.isDestroyed()) {
      entry.win.contentView.removeChildView(entry.view)
      for (const mask of entry.masks) entry.win.contentView.removeChildView(mask)
    }
    if (entry.view.webContents.isDestroyed()) return
    entry.view.webContents.close()
  }

  function disposeWindow(windowID: number) {
    const windowContexts = contexts.get(windowID)
    if (!windowContexts) return
    for (const entry of windowContexts.values()) disposeEntry(entry)
  }

  function pruneWindow(windowID: number) {
    const windowContexts = contexts.get(windowID)
    if (!windowContexts) return
    const evictions = browserContextEvictions(
      [...windowContexts.values()].map((entry) => ({
        id: entry.contextSessionID,
        attached: entry.attached,
        lastUsed: entry.lastUsed,
      })),
    )
    for (const id of evictions) {
      const entry = windowContexts.get(id)
      if (entry) disposeEntry(entry)
    }
  }

  return { setEnabled, setLayout, command, state, request, dispose }
}

export type BrowserPaneController = ReturnType<typeof createBrowserPaneController>

async function execute(
  entry: Entry,
  command: Exclude<BrowserControl.Command, { readonly type: "status" }>,
  abort: AbortSignal,
  verify: () => void,
) {
  throwIfAborted(abort)
  assertDocument(entry, command.generation)
  switch (command.type) {
    case "navigate":
      await navigate(entry, command.url, abort, verify)
      return { type: "action" as const, state: contractState(entry.state, entry.document) }
    case "snapshot":
      return snapshot(entry, command.generation, abort, verify)
    case "click":
      await click(entry, command.ref, command.generation, abort, verify)
      return { type: "action" as const, state: contractState(publishState(entry), entry.document) }
    case "fill":
      await fill(entry, command.ref, command.text, command.generation, abort, verify)
      return { type: "action" as const, state: contractState(publishState(entry), entry.document) }
    case "press":
      await press(entry, command.key, command.generation, abort, verify)
      return { type: "action" as const, state: contractState(publishState(entry), entry.document) }
    case "scroll":
      await scroll(entry, command.direction, command.amount, command.generation, abort, verify)
      return { type: "action" as const, state: contractState(publishState(entry), entry.document) }
    case "screenshot":
      return screenshot(entry, command.generation, abort, verify)
  }
  throw new Error("Unsupported browser command")
}

async function navigate(entry: Entry, input: string, abort?: AbortSignal, verify?: () => void) {
  const url = normalizeBrowserURL(input)
  if (!allowedBrowserURL(url)) {
    throw browserError("invalid_url", "Only HTTP, HTTPS, and file URLs are supported.", false)
  }
  entry.approvedOrigin = browserDestinationOrigin(url)
  throwIfAborted(abort)
  const onAbort = () => entry.view.webContents.stop()
  abort?.addEventListener("abort", onAbort, { once: true })
  await boundedBrowserOperation(() => entry.view.webContents.loadURL(url), {
    signal: abort,
    timeout: 30_000,
    aborted: () => browserError("aborted", "The browser navigation was aborted.", true),
    timedOut: () => browserError("timeout", "The browser navigation timed out.", true),
  })
    .catch((error) => {
      if (abort?.aborted) throw browserError("aborted", "The browser navigation was aborted.", true)
      if (error instanceof Error && "code" in error) throw error
      throw browserError("navigation_failed", String(error), true)
    })
    .finally(() => abort?.removeEventListener("abort", onAbort))
  throwIfAborted(abort)
  verify?.()
  publishState(entry)
}

async function snapshot(
  entry: Entry,
  generation: number,
  abort?: AbortSignal,
  verify?: () => void,
): Promise<BrowserControl.Result> {
  throwIfAborted(abort)
  // The fixed traversal stops in the page process; cross-origin iframe contents are intentionally omitted.
  const object = await debuggerCommand(
    entry,
    "Runtime.evaluate",
    {
      expression: browserSnapshotExpression(entry.nextRef),
    },
    abort,
  )
  const objectID = readRuntimeObjectID(object)
  const result = await debuggerCommand(
    entry,
    "Runtime.callFunctionOn",
    {
      objectId: objectID,
      functionDeclaration: "function() { return this.result }",
      returnByValue: true,
    },
    abort,
  )
    .then((response) => {
      verify?.()
      throwIfAborted(abort)
      assertDocument(entry, generation)
      return readSnapshot(response)
    })
    .catch((error) => {
      releaseSnapshotObject(entry, objectID)
      throw error
    })

  invalidateRefs(entry)
  entry.snapshotObjectID = objectID
  entry.nextRef = Math.max(entry.nextRef, result.nextRef)
  const lines = result.nodes.flatMap((node) => {
    const ref = node.token ? `@${node.token}` : undefined
    if (ref && node.token) entry.refs.set(ref, { snapshot: entry.snapshot, token: node.token, objectID })
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
    return [
      `${"  ".repeat(node.depth)}${ref ? `${ref} ` : ""}[${node.role}]${detail ? ` ${detail}` : ""}${properties.length ? ` ${properties.join(" ")}` : ""}`,
    ]
  })
  const content = [
    `Page: ${entry.view.webContents.getTitle()}`,
    `URL: ${entry.view.webContents.getURL()}`,
    "",
    ...lines,
  ]
    .join("\n")
    .slice(0, 40 * 1024)
  assertDocument(entry, generation)
  verify?.()
  return { type: "snapshot", state: contractState(publishState(entry), entry.document), content }
}

async function click(entry: Entry, ref: string, generation: number, abort: AbortSignal, verify: () => void) {
  const node = resolveRef(entry, ref)
  const response = await debuggerCommand(
    entry,
    "Runtime.callFunctionOn",
    {
      objectId: node.objectID,
      functionDeclaration:
        "function(token) { const element = this.refs[token]; if (!element || !element.isConnected) throw new Error('stale element'); element.scrollIntoView({ block: 'center', inline: 'center' }); const bounds = element.getBoundingClientRect(); if (bounds.width <= 0 || bounds.height <= 0) throw new Error('element has no bounds'); return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 } }",
      arguments: [{ value: node.token }],
      returnByValue: true,
    },
    abort,
  )
  verify()
  const point = readPoint(response)
  throwIfAborted(abort)
  assertDocument(entry, generation)
  await debuggerCommand(entry, "Input.dispatchMouseEvent", { type: "mouseMoved", ...point }, abort)
  verify()
  assertDocument(entry, generation)
  await runBrowserInputPair({
    assert: () => {
      verify()
      assertDocument(entry, generation)
    },
    press: () =>
      debuggerCommand(
        entry,
        "Input.dispatchMouseEvent",
        { type: "mousePressed", button: "left", clickCount: 1, ...point },
        abort,
      ).then(() => undefined),
    release: () =>
      debuggerCommand(entry, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        button: "left",
        clickCount: 1,
        ...point,
      }).then(() => undefined),
  })
}

async function fill(
  entry: Entry,
  ref: string,
  text: string,
  generation: number,
  abort: AbortSignal,
  verify: () => void,
) {
  if (text.length > 10_000) {
    throw browserError("result_too_large", "Browser fill text exceeds 10,000 characters.", false)
  }
  throwIfAborted(abort)
  const node = resolveRef(entry, ref)
  const response = await debuggerCommand(
    entry,
    "Runtime.callFunctionOn",
    {
      objectId: node.objectID,
      functionDeclaration:
        "function(token) { const element = this.refs[token]; if (!element || !element.isConnected) throw new Error('stale element'); element.focus(); return true }",
      arguments: [{ value: node.token }],
      returnByValue: true,
    },
    abort,
  )
  readRuntimeValue(response)
  verify()
  assertDocument(entry, generation)
  const modifiers = process.platform === "darwin" ? 4 : 2
  const assert = () => {
    verify()
    assertDocument(entry, generation)
  }
  await runBrowserInputPair({
    assert,
    press: () =>
      debuggerCommand(
        entry,
        "Input.dispatchKeyEvent",
        { type: "keyDown", key: "a", code: "KeyA", modifiers },
        abort,
      ).then(() => undefined),
    release: () =>
      debuggerCommand(entry, "Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers }).then(
        () => undefined,
      ),
  })
  await runBrowserInputPair({
    assert,
    press: () =>
      debuggerCommand(
        entry,
        "Input.dispatchKeyEvent",
        { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
        abort,
      ).then(() => undefined),
    release: () =>
      debuggerCommand(entry, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Backspace",
        code: "Backspace",
        windowsVirtualKeyCode: 8,
      }).then(() => undefined),
  })
  await debuggerCommand(entry, "Input.insertText", { text }, abort)
  verify()
}

async function press(
  entry: Entry,
  key: Extract<BrowserControl.Command, { readonly type: "press" }>["key"],
  generation: number,
  abort: AbortSignal,
  verify: () => void,
) {
  throwIfAborted(abort)
  assertDocument(entry, generation)
  const info = keyInfo(key)
  await runBrowserInputPair({
    assert: () => {
      verify()
      assertDocument(entry, generation)
    },
    press: () =>
      debuggerCommand(entry, "Input.dispatchKeyEvent", { type: "keyDown", ...info }, abort).then(() => undefined),
    release: () => debuggerCommand(entry, "Input.dispatchKeyEvent", { type: "keyUp", ...info }).then(() => undefined),
  })
}

async function scroll(
  entry: Entry,
  direction: Extract<BrowserControl.Command, { readonly type: "scroll" }>["direction"],
  amount: number,
  generation: number,
  abort: AbortSignal,
  verify: () => void,
) {
  throwIfAborted(abort)
  assertDocument(entry, generation)
  const bounds = entry.view.getBounds()
  const distance = Math.min(2000, Math.max(1, amount))
  await debuggerCommand(
    entry,
    "Input.dispatchMouseEvent",
    {
      type: "mouseWheel",
      x: Math.max(0, Math.round(bounds.width / 2)),
      y: Math.max(0, Math.round(bounds.height / 2)),
      deltaX: direction === "left" ? -distance : direction === "right" ? distance : 0,
      deltaY: direction === "up" ? -distance : direction === "down" ? distance : 0,
    },
    abort,
  )
  verify()
}

async function screenshot(
  entry: Entry,
  generation: number,
  abort?: AbortSignal,
  verify?: () => void,
): Promise<BrowserControl.Result> {
  throwIfAborted(abort)
  const source = await entry.view.webContents.capturePage()
  verify?.()
  throwIfAborted(abort)
  assertDocument(entry, generation)
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
  assertDocument(entry, generation)
  verify?.()
  return {
    type: "screenshot",
    state: contractState(publishState(entry), entry.document),
    data: output.toString("base64"),
    width: dimensions.width,
    height: dimensions.height,
  }
}

function resolveRef(entry: Entry, ref: string) {
  const node = entry.refs.get(normalizeBrowserRef(ref))
  if (!node || node.snapshot !== entry.snapshot) {
    throw browserError("stale_ref", "The element reference is stale. Call browser_snapshot again.", true)
  }
  return node
}

async function debuggerCommand(entry: Entry, method: string, params?: Record<string, unknown>, abort?: AbortSignal) {
  throwIfAborted(abort)
  const api = entry.view.webContents.debugger
  if (!api.isAttached()) api.attach("1.3")
  return boundedBrowserOperation(() => api.sendCommand(method, params), {
    signal: abort,
    timeout: debuggerCommandTimeout,
    aborted: () => browserError("aborted", "The browser action was aborted.", true),
    timedOut: () => browserError("timeout", "The browser command timed out.", true),
  }).catch((error) => {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "timeout" || error.code === "aborted") &&
      api.isAttached()
    )
      api.detach()
    throw error
  })
}

function readSnapshot(input: unknown) {
  const value = readRuntimeValue(input)
  if (
    !record(value) ||
    !Array.isArray(value.nodes) ||
    typeof value.nextRef !== "number" ||
    !Number.isSafeInteger(value.nextRef)
  ) {
    throw new Error("Invalid browser snapshot response")
  }
  if (value.nodes.length > browserSnapshotLimit || !value.nodes.every(snapshotNode)) {
    throw new Error("Invalid browser snapshot nodes")
  }
  return { nodes: value.nodes, nextRef: value.nextRef }
}

function snapshotNode(input: unknown): input is SnapshotNode {
  if (!record(input)) return false
  if (
    typeof input.role !== "string" ||
    typeof input.name !== "string" ||
    typeof input.value !== "string" ||
    !Number.isSafeInteger(input.depth) ||
    Number(input.depth) < 0 ||
    Number(input.depth) > 6
  )
    return false
  if (input.token !== undefined && (typeof input.token !== "string" || !/^e\d+$/.test(input.token))) return false
  if (input.expanded !== undefined && typeof input.expanded !== "boolean") return false
  return [input.checked, input.disabled, input.selected].every(
    (property) => property === undefined || typeof property === "boolean",
  )
}

function readRuntimeObjectID(input: unknown) {
  if (!record(input) || !record(input.result) || typeof input.result.objectId !== "string") {
    throw new Error("Invalid browser runtime object")
  }
  return input.result.objectId
}

function readRuntimeValue(input: unknown) {
  if (!record(input) || input.exceptionDetails !== undefined || !record(input.result) || !("value" in input.result)) {
    throw new Error("Browser page operation failed")
  }
  return input.result.value
}

function readPoint(input: unknown) {
  const value = readRuntimeValue(input)
  if (!record(value) || typeof value.x !== "number" || typeof value.y !== "number") {
    throw new Error("Browser element has no clickable bounds")
  }
  return { x: value.x, y: value.y }
}

function keyInfo(key: Extract<BrowserControl.Command, { readonly type: "press" }>["key"]) {
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

function publishState(entry: Entry) {
  const contents = entry.view.webContents
  const state = {
    url: contents.getURL(),
    title: contents.getTitle(),
    loading: contents.isLoading(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
  }
  entry.state = state
  if (!entry.win.isDestroyed()) entry.win.webContents.send("browser-pane-state", state)
  return state
}

function contractState(state: BrowserPaneState, generation: number): BrowserControl.State {
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

function assertActive(
  entry: Entry,
  sessionID: string,
  lease: string | undefined,
  attachment: number,
  abort?: AbortSignal,
) {
  throwIfAborted(abort)
  if (!entry.attached || entry.sessionID !== sessionID || entry.lease !== lease || entry.attachment !== attachment) {
    throw browserError("not_attached", "The browser pane is no longer attached to this session.", true)
  }
}

function cancelEntry(entry: Entry) {
  entry.attachment++
  invalidateRefs(entry)
  entry.active?.abort()
  entry.active = undefined
  for (const request of entry.requests) request.abort()
  entry.requests.clear()
  if (!entry.view.webContents.isDestroyed()) entry.view.webContents.stop()
}

function invalidateRefs(entry: Entry) {
  const objectID = entry.snapshotObjectID
  entry.snapshotObjectID = undefined
  invalidateBrowserRefs(entry)
  if (objectID) releaseSnapshotObject(entry, objectID)
}

function releaseSnapshotObject(entry: Entry, objectID: string) {
  const api = entry.view.webContents.debugger
  if (!api.isAttached()) return
  void api.sendCommand("Runtime.releaseObject", { objectId: objectID }).catch(() => undefined)
}

async function active<T>(entry: Entry, controller: AbortController, run: () => Promise<T>) {
  entry.active = controller
  try {
    return await run()
  } finally {
    if (entry.active === controller) entry.active = undefined
  }
}

function detach(entry: Entry) {
  if (entry.attached || entry.sessionID || entry.lease) cancelEntry(entry)
  entry.attached = false
  entry.sessionID = undefined
  entry.lease = undefined
  hideEntry(entry)
}

function hideEntry(entry: Entry) {
  entry.view.setVisible(false)
  for (const mask of entry.masks) mask.setVisible(false)
}

function assertDocument(entry: Entry, generation: number) {
  if (entry.document !== generation) {
    throw browserError("stale_ref", "The browser page changed. Call browser_snapshot again.", true)
  }
}

function throwIfAborted(abort?: AbortSignal) {
  if (abort?.aborted) throw browserError("aborted", "The browser action was aborted.", true)
}

function browserError(code: BrowserControl.ErrorCode, message: string, retryable: boolean) {
  return Object.assign(new Error(message), { code, retryable })
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
