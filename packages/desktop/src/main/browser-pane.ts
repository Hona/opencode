import { DesktopBrowser } from "@opencode-ai/core/desktop-browser"
import { BrowserWindow, View, WebContentsView } from "electron"
import type { BrowserPaneCommand, BrowserPaneLayout, BrowserPaneState } from "../preload/types"
import {
  allowedBrowserURL,
  browserBottomMasks,
  normalizeBrowserBounds,
  normalizeBrowserRef,
  normalizeBrowserURL,
} from "./browser-pane-policy"

type Ref = { snapshot: number; backendNodeID: number }
type Entry = {
  win: BrowserWindow
  view: WebContentsView
  masks: View[]
  attached: boolean
  sessionID?: string
  attachment: number
  document: number
  snapshot: number
  refs: Map<string, Ref>
  requests: Set<AbortController>
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

export function createBrowserPaneController() {
  const entries = new Map<number, Entry>()

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

  const create = (win: BrowserWindow) => {
    const view = new WebContentsView({
      webPreferences: {
        partition: `opencode-browser-${win.id}`,
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

    const entry: Entry = {
      win,
      view,
      masks,
      attached: false,
      attachment: 0,
      document: 0,
      snapshot: 0,
      refs: new Map(),
      requests: new Set(),
      state: { url: "", title: "", loading: false, canGoBack: false, canGoForward: false },
      queue: Promise.resolve(),
    }
    entries.set(win.id, entry)

    const contents = view.webContents
    const browserSession = contents.session
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.setDevicePermissionHandler(() => false)
    browserSession.setDisplayMediaRequestHandler((_request, callback) => callback({}))
    browserSession.on("will-download", (event) => event.preventDefault())

    const preventUnsafeNavigation = (event: Electron.Event<{ url: string }>) => {
      if (allowedBrowserURL(event.url)) return
      event.preventDefault()
      publish(entry, "Navigation was blocked by the browser security policy")
    }
    contents.on("will-navigate", preventUnsafeNavigation)
    contents.on("will-redirect", preventUnsafeNavigation)
    contents.setWindowOpenHandler((details) => {
      if (allowedBrowserURL(details.url)) {
        void navigate(entry, details.url).catch((error) =>
          publish(entry, error instanceof Error ? error.message : String(error)),
        )
      }
      return { action: "deny" }
    })
    contents.on("content-bounds-updated", (event) => event.preventDefault())
    contents.on("did-start-loading", () => publish(entry))
    contents.on("did-stop-loading", () => publish(entry))
    contents.on("did-navigate", () => publish(entry))
    contents.on("did-navigate-in-page", () => publish(entry))
    contents.on("page-title-updated", () => publish(entry))
    contents.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => {
      if (!isMainFrame) return
      entry.document++
      entry.snapshot++
      entry.refs.clear()
    })
    contents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return
      publish(entry, description)
    })
    contents.on("render-process-gone", () => {
      entry.document++
      entry.snapshot++
      entry.refs.clear()
      publish(entry, "The browser page crashed")
    })
    win.webContents.on("did-start-navigation", () => {
      cancelEntry(entry)
      entry.attached = false
      entry.sessionID = undefined
      hideEntry(entry)
    })
    win.webContents.on("render-process-gone", () => {
      cancelEntry(entry)
      entry.attached = false
      entry.sessionID = undefined
      hideEntry(entry)
    })
    contents.debugger.on("detach", () => {
      entry.snapshot++
      entry.refs.clear()
    })
    win.once("closed", () => disposeEntry(entry))
    void contents.loadURL("about:blank")
    return entry
  }

  const setLayout = (win: BrowserWindow, layout: BrowserPaneLayout) => {
    const entry = entries.get(win.id)
    if (layout.destroy) {
      if (entry) disposeEntry(entry)
      return
    }
    if (!layout.attached || !layout.sessionID) {
      if (!entry) return
      if (entry.attached || entry.sessionID) cancelEntry(entry)
      entry.attached = false
      entry.sessionID = undefined
      hideEntry(entry)
      return
    }

    const next = entry ?? create(win)
    const owner = [...entries.values()].find(
      (item) => item !== next && item.attached && item.sessionID === layout.sessionID,
    )
    if (owner) {
      if (next.attached || next.sessionID) cancelEntry(next)
      next.attached = false
      next.sessionID = undefined
      publish(next, "Browser tools for this session are attached in another window")
    } else {
      if (!next.attached || next.sessionID !== layout.sessionID) cancelEntry(next)
      next.attached = true
      next.sessionID = layout.sessionID
    }
    if (!layout.visible || !layout.bounds) {
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
    switch (input.type) {
      case "navigate":
        await navigate(entry, input.url)
        return
      case "back":
        if (entry.view.webContents.navigationHistory.canGoBack()) entry.view.webContents.navigationHistory.goBack()
        return
      case "forward":
        if (entry.view.webContents.navigationHistory.canGoForward()) {
          entry.view.webContents.navigationHistory.goForward()
        }
        return
      case "reload":
        entry.view.webContents.reload()
        return
      case "stop":
        entry.view.webContents.stop()
        return
    }
  }

  const state = (win: BrowserWindow) => entries.get(win.id)?.state ?? emptyState()

  const request = async (input: DesktopBrowser.Request, abort?: AbortSignal): Promise<DesktopBrowser.Result> => {
    const matches = [...entries.values()].filter((entry) => entry.attached && entry.sessionID === input.sessionID)
    const command = input.command
    if (command.type === "status") {
      const entry = matches.length === 1 ? matches[0] : undefined
      return {
        type: "status",
        attached: !!entry,
        ...(entry ? { state: contractState(publish(entry), entry.document) } : {}),
      }
    }
    if (matches.length === 0)
      throw browserError("not_attached", "Open the Browser pane for this session and retry.", true)
    if (matches.length > 1)
      throw browserError("internal", "More than one browser pane is attached to this session.", false)
    const entry = matches[0]
    const attachment = entry.attachment
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    abort?.addEventListener("abort", onAbort, { once: true })
    entry.requests.add(controller)
    return enqueue(entry, async () => {
      const verify = () => assertActive(entry, input.sessionID, attachment, controller.signal)
      verify()
      return execute(entry, command, controller.signal, verify)
    }).finally(() => {
      abort?.removeEventListener("abort", onAbort)
      entry.requests.delete(controller)
    })
  }

  const dispose = () => {
    for (const entry of entries.values()) disposeEntry(entry)
    entries.clear()
  }

  function disposeEntry(entry: Entry) {
    entries.delete(entry.win.id)
    cancelEntry(entry)
    if (!entry.win.isDestroyed()) {
      entry.win.contentView.removeChildView(entry.view)
      for (const mask of entry.masks) entry.win.contentView.removeChildView(mask)
    }
    if (entry.view.webContents.isDestroyed()) return
    entry.view.webContents.close()
  }

  return { setLayout, command, state, request, dispose }
}

export type BrowserPaneController = ReturnType<typeof createBrowserPaneController>

async function execute(
  entry: Entry,
  command: Exclude<DesktopBrowser.Command, { type: "status" }>,
  abort: AbortSignal,
  verify: () => void,
) {
  throwIfAborted(abort)
  if (command.type !== "navigate") assertDocument(entry, command.generation)
  switch (command.type) {
    case "navigate":
      await navigate(entry, command.url, abort)
      return { type: "action" as const, state: contractState(entry.state, entry.document) }
    case "snapshot":
      return snapshot(entry, command.generation, abort)
    case "click":
      await click(entry, command.ref, command.generation, abort, verify)
      return { type: "action" as const, state: contractState(publishState(entry), entry.document) }
    case "fill":
      await fill(entry, command.ref, command.text, command.generation, abort, verify)
      return { type: "action" as const, state: contractState(publishState(entry), entry.document) }
    case "press":
      await press(entry, command.key, command.generation, abort)
      return { type: "action" as const, state: contractState(publishState(entry), entry.document) }
    case "scroll":
      await scroll(entry, command.direction, command.amount, command.generation, abort)
      return { type: "action" as const, state: contractState(publishState(entry), entry.document) }
    case "screenshot":
      return screenshot(entry, command.generation, abort)
  }
  throw new Error("Unsupported browser command")
}

async function navigate(entry: Entry, input: string, abort?: AbortSignal) {
  const url = normalizeBrowserURL(input)
  if (!allowedBrowserURL(url)) {
    throw browserError("invalid_url", "Only HTTP, HTTPS, and file URLs are supported.", false)
  }
  throwIfAborted(abort)
  const onAbort = () => entry.view.webContents.stop()
  abort?.addEventListener("abort", onAbort, { once: true })
  await entry.view.webContents
    .loadURL(url)
    .catch((error) => {
      if (abort?.aborted) throw browserError("aborted", "The browser navigation was aborted.", true)
      throw browserError("navigation_failed", String(error), true)
    })
    .finally(() => abort?.removeEventListener("abort", onAbort))
  throwIfAborted(abort)
  publishState(entry)
}

async function snapshot(entry: Entry, generation: number, abort?: AbortSignal): Promise<DesktopBrowser.Result> {
  throwIfAborted(abort)
  await debuggerCommand(entry, "Accessibility.enable")
  const response = await debuggerCommand(entry, "Accessibility.getFullAXTree")
  throwIfAborted(abort)
  assertDocument(entry, generation)
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

  entry.snapshot++
  entry.refs.clear()
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
    const ref = interactive && typeof node.backendDOMNodeId === "number" ? `@e${++index}` : undefined
    if (ref && node.backendDOMNodeId) {
      entry.refs.set(ref, { snapshot: entry.snapshot, backendNodeID: node.backendDOMNodeId })
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
  const content = [
    `Page: ${entry.view.webContents.getTitle()}`,
    `URL: ${entry.view.webContents.getURL()}`,
    "",
    ...lines,
  ]
    .join("\n")
    .slice(0, 40 * 1024)
  assertDocument(entry, generation)
  return { type: "snapshot", state: contractState(publishState(entry), entry.document), content }
}

async function click(entry: Entry, ref: string, generation: number, abort: AbortSignal, verify: () => void) {
  const node = resolveRef(entry, ref)
  await debuggerCommand(entry, "DOM.scrollIntoViewIfNeeded", { backendNodeId: node.backendNodeID })
  verify()
  assertDocument(entry, generation)
  const response = await debuggerCommand(entry, "DOM.getBoxModel", { backendNodeId: node.backendNodeID })
  verify()
  const quad = readBoxQuad(response)
  const point = {
    x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
    y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4,
  }
  throwIfAborted(abort)
  assertDocument(entry, generation)
  await debuggerCommand(entry, "Input.dispatchMouseEvent", { type: "mouseMoved", ...point })
  verify()
  assertDocument(entry, generation)
  await debuggerCommand(entry, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    clickCount: 1,
    ...point,
  })
  await debuggerCommand(entry, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    clickCount: 1,
    ...point,
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
  if (text.length > 10_000)
    throw browserError("result_too_large", "Browser fill text exceeds 10,000 characters.", false)
  throwIfAborted(abort)
  const node = resolveRef(entry, ref)
  await debuggerCommand(entry, "DOM.focus", { backendNodeId: node.backendNodeID })
  verify()
  assertDocument(entry, generation)
  const modifiers = process.platform === "darwin" ? 4 : 2
  await debuggerCommand(entry, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "a",
    code: "KeyA",
    modifiers,
  })
  await debuggerCommand(entry, "Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers })
  verify()
  assertDocument(entry, generation)
  await debuggerCommand(entry, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Backspace",
    code: "Backspace",
    windowsVirtualKeyCode: 8,
  })
  await debuggerCommand(entry, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Backspace",
    code: "Backspace",
    windowsVirtualKeyCode: 8,
  })
  verify()
  assertDocument(entry, generation)
  await debuggerCommand(entry, "Input.insertText", { text })
}

async function press(
  entry: Entry,
  key: Extract<DesktopBrowser.Command, { type: "press" }>["key"],
  generation: number,
  abort?: AbortSignal,
) {
  throwIfAborted(abort)
  assertDocument(entry, generation)
  const info = keyInfo(key)
  await debuggerCommand(entry, "Input.dispatchKeyEvent", { type: "keyDown", ...info })
  await debuggerCommand(entry, "Input.dispatchKeyEvent", { type: "keyUp", ...info })
}

async function scroll(
  entry: Entry,
  direction: Extract<DesktopBrowser.Command, { type: "scroll" }>["direction"],
  amount: number,
  generation: number,
  abort?: AbortSignal,
) {
  throwIfAborted(abort)
  assertDocument(entry, generation)
  const bounds = entry.view.getBounds()
  const distance = Math.min(2000, Math.max(1, amount))
  await debuggerCommand(entry, "Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: Math.max(0, Math.round(bounds.width / 2)),
    y: Math.max(0, Math.round(bounds.height / 2)),
    deltaX: direction === "left" ? -distance : direction === "right" ? distance : 0,
    deltaY: direction === "up" ? -distance : direction === "down" ? distance : 0,
  })
}

async function screenshot(entry: Entry, generation: number, abort?: AbortSignal): Promise<DesktopBrowser.Result> {
  throwIfAborted(abort)
  const source = await entry.view.webContents.capturePage()
  throwIfAborted(abort)
  assertDocument(entry, generation)
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

async function debuggerCommand(entry: Entry, method: string, params?: Record<string, unknown>) {
  const api = entry.view.webContents.debugger
  if (!api.isAttached()) api.attach("1.3")
  return (await api.sendCommand(method, params)) as unknown
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

function assertActive(entry: Entry, sessionID: string, attachment: number, abort?: AbortSignal) {
  throwIfAborted(abort)
  if (!entry.attached || entry.sessionID !== sessionID || entry.attachment !== attachment) {
    throw browserError("not_attached", "The browser pane is no longer attached to this session.", true)
  }
}

function cancelEntry(entry: Entry) {
  entry.attachment++
  for (const request of entry.requests) request.abort()
  entry.requests.clear()
  if (!entry.view.webContents.isDestroyed()) entry.view.webContents.stop()
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

function browserError(code: DesktopBrowser.ErrorCode, message: string, retryable: boolean) {
  return Object.assign(new Error(message), { code, retryable })
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
