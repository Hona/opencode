import electron, { type BrowserWindow, type NativeImage, type WebContents, type WebContentsView } from "electron"
import { decodePresenterEvents, editCommand, toInputEvents } from "./presenter-input"

export type Presenters = ReturnType<typeof createPresenters>

export type Presenter = {
  /** The view the host embed system lays out where the page would be. */
  readonly view: WebContentsView
  dispose(): void
}

type Waiter = () => void

type Entry = {
  readonly page: WebContents
  readonly window: BrowserWindow
  frame: number
  image?: NativeImage
  frames: Set<Waiter>
  cursor: { id: number; value: string }
  cursors: Set<Waiter>
  focused: boolean
  /** When the next frame may be encoded, in `performance.now()` time. */
  encode: number
}

// Electron's cursor names, as CSS cursors.
const cursors = new Map(
  Object.entries({
    default: "default",
    pointer: "default",
    hand: "pointer",
    ibeam: "text",
    "vertical-text": "vertical-text",
    crosshair: "crosshair",
    wait: "wait",
    progress: "progress",
    help: "help",
    move: "move",
    "col-resize": "col-resize",
    "row-resize": "row-resize",
    "e-resize": "e-resize",
    "n-resize": "n-resize",
    "ne-resize": "ne-resize",
    "nw-resize": "nw-resize",
    "s-resize": "s-resize",
    "se-resize": "se-resize",
    "sw-resize": "sw-resize",
    "w-resize": "w-resize",
    "ns-resize": "ns-resize",
    "ew-resize": "ew-resize",
    "nesw-resize": "nesw-resize",
    "nwse-resize": "nwse-resize",
    "not-allowed": "not-allowed",
    "no-drop": "no-drop",
    grab: "grab",
    grabbing: "grabbing",
    "zoom-in": "zoom-in",
    "zoom-out": "zoom-out",
    copy: "copy",
    alias: "alias",
    "context-menu": "context-menu",
    cell: "cell",
    none: "none",
  }),
)

const headers = { "cache-control": "no-store" }

/**
 * Shows the agent's offscreen pages in the pane. Each presenter is a small trusted page in its own partition that
 * pulls the latest frame of its offscreen page and posts the user's input back, both through a protocol handler only
 * that partition reaches. One per browser pane instance.
 */
export function createPresenters() {
  const partition = `opencode-browser-presenter-${crypto.randomUUID()}`
  const session = electron.session.fromPartition(partition)
  const entries = new Map<string, Entry>()

  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
  session.protocol.handle("https", async (request) => {
    const url = new URL(request.url)
    const entry = entries.get(url.hostname)

    if (!entry || entry.page.isDestroyed()) return new Response("Not found", { status: 404, headers })

    if (url.pathname === "/") return new Response(page, { headers: { ...headers, "content-type": "text/html" } })

    if (url.pathname === "/frame")
      return frame(entry, Number(url.searchParams.get("after") ?? 0), Number(url.searchParams.get("width") ?? 0))

    if (url.pathname === "/events") return cursor(entry, Number(url.searchParams.get("after") ?? 0))

    if (url.pathname === "/input" && request.method === "POST") {
      input(entry, await request.text())

      return new Response(null, { status: 204, headers })
    }

    return new Response("Not found", { status: 404, headers })
  })

  return {
    create(input: {
      /** The offscreen page's contents and the hidden window that owns them. */
      readonly page: WebContents
      readonly window: BrowserWindow
    }): Presenter {
      const host = `${crypto.randomUUID()}.presenter.invalid`

      const entry: Entry = {
        page: input.page,
        window: input.window,
        frame: 0,
        frames: new Set(),
        cursor: { id: 0, value: "default" },
        cursors: new Set(),
        focused: false,
        encode: 0,
      }

      // Only the newest frame is kept; a presenter that falls behind skips to it.
      const paint = (_event: Electron.Event, _dirty: Electron.Rectangle, image: NativeImage) => {
        entry.image = image
        entry.frame++
        wake(entry.frames)
      }

      const changed = (_event: Electron.Event, type: string) => {
        entry.cursor = { id: entry.cursor.id + 1, value: cursors.get(type) ?? "default" }
        wake(entry.cursors)
      }

      input.page.on("paint", paint)
      input.page.on("cursor-changed", changed)
      entries.set(host, entry)

      const view = new electron.WebContentsView({
        webPreferences: {
          partition,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          devTools: false,
          spellcheck: false,
        },
      })

      view.setBackgroundColor("#00000000")
      view.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
      view.webContents.on("will-navigate", (event) => event.preventDefault())
      void view.webContents.loadURL(`https://${host}/`).catch(() => undefined)

      return {
        view,
        dispose() {
          entries.delete(host)
          wake(entry.frames)
          wake(entry.cursors)

          if (!input.page.isDestroyed()) {
            input.page.off("paint", paint)
            input.page.off("cursor-changed", changed)
          }

          if (!view.webContents.isDestroyed()) view.webContents.close()
        },
      }
    },
    dispose() {
      entries.forEach((entry) => {
        wake(entry.frames)
        wake(entry.cursors)
      })
      entries.clear()
      session.protocol.unhandle("https")
    },
  }
}

function wake(waiters: Set<Waiter>) {
  const list = Array.from(waiters)
  waiters.clear()
  list.forEach((waiter) => waiter())
}

/** Resolves once a newer value arrives, or after a second so the presenter polls again. */
function newer(waiters: Set<Waiter>, current: () => number, after: number) {
  if (current() > after) return Promise.resolve()

  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, 1_000)

    function done() {
      clearTimeout(timer)
      waiters.delete(done)
      resolve()
    }

    waiters.add(done)
  })
}

async function frame(entry: Entry, after: number, width: number) {
  await newer(entry.frames, () => entry.frame, after)
  // Encoding runs on the main thread, which every window's input and IPC share; frames take at most a quarter of it.
  // Measured in Electron 44: a 2560x1600 frame costs about 32 ms as JPEG, and 16 ms shrunk to 1280 wide first.
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, entry.encode - performance.now())))

  // A page that has not painted since the presenter appeared still has a picture to show. A failed capture is no new
  // frame, so the presenter waits for a paint instead of asking again at once.
  if (!entry.image && !entry.page.isDestroyed()) {
    const image = await entry.page.capturePage().catch(() => undefined)

    if (image && !image.isEmpty()) {
      entry.image = image
      entry.frame++
    }
  }

  if (entry.frame <= after || !entry.image || entry.image.isEmpty()) return new Response(null, { status: 204, headers })
  const [cssWidth, cssHeight] = entry.window.isDestroyed() ? [0, 0] : entry.window.getContentSize()
  const started = performance.now()

  // The pane draws the page scaled to fit, so pixels beyond the canvas's own are never seen.
  const image =
    width > 0 && entry.image.getSize().width > width ? entry.image.resize({ width, quality: "good" }) : entry.image

  const jpeg = image.toJPEG(85)
  entry.encode = performance.now() + 3 * (performance.now() - started)

  return new Response(new Uint8Array(jpeg), {
    headers: {
      ...headers,
      "content-type": "image/jpeg",
      "x-frame": String(entry.frame),
      "x-width": String(cssWidth ?? 0),
      "x-height": String(cssHeight ?? 0),
    },
  })
}

async function cursor(entry: Entry, after: number) {
  await newer(entry.cursors, () => entry.cursor.id, after)

  return Response.json({ id: entry.cursor.id, cursor: entry.cursor.value }, { headers })
}

function input(entry: Entry, body: string) {
  decodePresenterEvents(body).forEach((event) => {
    if (entry.page.isDestroyed()) return

    // Offscreen contents take keyboard and pointer input only while they have focus.
    if (event.kind === "focus" || !entry.focused) {
      entry.page.focus()
      entry.focused = true
    }

    if (event.kind === "text") {
      entry.page.insertText(event.text).catch(() => undefined)

      return
    }

    // On macOS the app menu, not the page, turns Cmd+C and similar chords into editing commands, and an offscreen page
    // has no menu, so the command runs on the page itself.
    const command = process.platform === "darwin" && event.kind === "key" ? editCommand(event) : undefined

    if (command) {
      if (event.kind === "key" && event.type === "down") edit(entry.page, command)

      return
    }

    toInputEvents(event).forEach((item) => entry.page.sendInputEvent(item))
  })
}

function edit(page: WebContents, command: NonNullable<ReturnType<typeof editCommand>>) {
  if (command === "copy") return page.copy()

  if (command === "cut") return page.cut()

  if (command === "paste") return page.paste()

  if (command === "selectAll") return page.selectAll()

  if (command === "undo") return page.undo()

  return page.redo()
}

// The presenter page: draws the newest frame into the view, scaled down to fit and letterboxed, and posts the user's
// input, in order. The page keeps the agent's size whatever the pane's, so watching never changes its layout.
const page = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
  canvas { display: block; width: 100vw; height: 100vh; outline: none; touch-action: none; }
</style>
</head>
<body>
<canvas id="screen" tabindex="0"></canvas>
<script>
"use strict"
const canvas = document.getElementById("screen")
const context = canvas.getContext("2d")
// The page's CSS size, and where its frame sits in the canvas.
const view = { width: 0, height: 0, scale: 1, left: 0, top: 0 }
let bitmap = null
let after = 0
let cursorAfter = 0
let running = false
let watching = false

const layout = () => {
  const ratio = devicePixelRatio || 1
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
  }
  view.scale = view.width && view.height ? Math.min(width / view.width, height / view.height, 1) : 1
  view.left = (width - view.width * view.scale) / 2
  view.top = (height - view.height * view.scale) / 2
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  if (bitmap) context.drawImage(bitmap, view.left, view.top, view.width * view.scale, view.height * view.scale)
}

const frames = async () => {
  if (running) return
  running = true
  while (document.visibilityState === "visible") {
    try {
      const response = await fetch("/frame?after=" + after + "&width=" + canvas.width, { cache: "no-store" })
      // 204 is a long poll with nothing new; anything else waits before asking again.
      if (response.status === 204) continue
      if (response.status !== 200) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        continue
      }
      after = Number(response.headers.get("x-frame")) || after
      view.width = Number(response.headers.get("x-width")) || view.width
      view.height = Number(response.headers.get("x-height")) || view.height
      const next = await createImageBitmap(await response.blob())
      if (bitmap) bitmap.close()
      bitmap = next
      layout()
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  running = false
}

const cursors = async () => {
  if (watching) return
  watching = true
  while (document.visibilityState === "visible") {
    try {
      const response = await fetch("/events?after=" + cursorAfter, { cache: "no-store" })
      const value = await response.json()
      cursorAfter = value.id
      canvas.style.cursor = value.cursor
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  watching = false
}

// One request at a time keeps the input in order; moves between two posts collapse into the newest.
const queue = []
let sending = false
const send = (event) => {
  const last = queue[queue.length - 1]
  if (event.kind === "mouse" && event.type === "move" && last && last.kind === "mouse" && last.type === "move") queue[queue.length - 1] = event
  else queue.push(event)
  void flush()
}
const flush = async () => {
  if (sending || !queue.length) return
  sending = true
  const batch = queue.splice(0)
  try {
    await fetch("/input", { method: "POST", body: JSON.stringify(batch) })
  } catch {}
  sending = false
  void flush()
}

const modifiers = (event) => ({ shift: event.shiftKey, control: event.ctrlKey, alt: event.altKey, meta: event.metaKey })
const position = (event) => {
  const rect = canvas.getBoundingClientRect()
  const x = (event.clientX - rect.left - view.left) / view.scale
  const y = (event.clientY - rect.top - view.top) / view.scale
  return { x: Math.max(0, Math.min(view.width, x)), y: Math.max(0, Math.min(view.height, y)) }
}
const pointer = (type) => (event) => {
  if (type === "down") {
    canvas.focus()
    if (event.button === 2) event.preventDefault()
  }
  send({ kind: "mouse", type, ...position(event), button: event.button === 1 || event.button === 2 ? event.button : 0, buttons: event.buttons, clicks: event.detail || 1, modifiers: modifiers(event) })
}

canvas.addEventListener("mousedown", pointer("down"))
canvas.addEventListener("mouseup", pointer("up"))
canvas.addEventListener("mousemove", pointer("move"))
canvas.addEventListener("mouseleave", pointer("leave"))
canvas.addEventListener("contextmenu", (event) => event.preventDefault())
canvas.addEventListener("wheel", (event) => {
  event.preventDefault()
  send({ kind: "wheel", ...position(event), deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, modifiers: modifiers(event) })
}, { passive: false })
canvas.addEventListener("focus", () => send({ kind: "focus" }))
const key = (type) => (event) => {
  // Keys an input method is composing reach the page as text when the composition ends.
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  send({ kind: "key", type, key: event.key, code: event.code, repeat: event.repeat, modifiers: modifiers(event) })
}
canvas.addEventListener("keydown", key("down"))
canvas.addEventListener("keyup", key("up"))
canvas.addEventListener("compositionend", (event) => { if (event.data) send({ kind: "text", text: event.data }) })
canvas.addEventListener("paste", (event) => event.preventDefault())

new ResizeObserver(layout).observe(canvas)

document.addEventListener("visibilitychange", () => {
  void frames()
  void cursors()
})
void frames()
void cursors()
</script>
</body>
</html>`
