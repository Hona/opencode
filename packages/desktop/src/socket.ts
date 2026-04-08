import type { Platform } from "@opencode-ai/app"
import { Channel } from "@tauri-apps/api/core"
import { commands, type SocketEvt, type SocketHead } from "./bindings"

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err))

export const socket: NonNullable<Platform["socket"]> = (url, opts) => {
  const ch = new Channel<SocketEvt>()
  const target = new EventTarget()
  const heads: SocketHead[] = Object.entries(opts?.headers ?? {}).map(([name, value]) => ({ name, value }))
  let mode: BinaryType = "arraybuffer"
  let id = ""
  let state: number = WebSocket.CONNECTING
  let done = false
  let queued: { code?: number; reason?: string } | undefined

  const close = (code = 1000, reason = "", clean = true) => {
    if (done) return
    done = true
    state = WebSocket.CLOSED
    target.dispatchEvent(
      new CloseEvent("close", {
        code,
        reason,
        wasClean: clean,
      }),
    )
  }

  const fail = (reason?: string) => {
    if (done) return
    target.dispatchEvent(new Event("error"))
    close(1006, reason ?? "", false)
  }

  ch.onmessage = (evt) => {
    switch (evt.type) {
      case "open": {
        if (done || state === WebSocket.CLOSING) return
        state = WebSocket.OPEN
        target.dispatchEvent(new Event("open"))
        return
      }
      case "text": {
        if (done) return
        target.dispatchEvent(new MessageEvent("message", { data: evt.data }))
        return
      }
      case "binary": {
        if (done) return
        const data = mode === "blob" ? new Blob([new Uint8Array(evt.data)]) : new Uint8Array(evt.data).buffer
        target.dispatchEvent(new MessageEvent("message", { data }))
        return
      }
      case "error": {
        fail(evt.message)
        return
      }
      case "close": {
        close(evt.code ?? 1000, evt.reason ?? "", evt.clean)
      }
    }
  }

  void commands
    .openSocket(url, heads, ch as any)
    .then((value) => {
      id = value
      if (!queued) return
      void commands.closeSocket(id, queued.code ?? null, queued.reason ?? null).catch((err) => fail(msg(err)))
    })
    .catch((err) => fail(msg(err)))

  return {
    get binaryType() {
      return mode
    },
    set binaryType(value) {
      mode = value
    },
    get readyState() {
      return state
    },
    send(data) {
      if (state !== WebSocket.OPEN || !id) return
      void commands.writeSocket(id, data).catch((err) => fail(msg(err)))
    },
    close(code?: number, reason?: string) {
      if (done || state === WebSocket.CLOSING) return
      state = WebSocket.CLOSING
      if (!id) {
        queued = { code, reason }
        return
      }
      void commands.closeSocket(id, code ?? null, reason ?? null).catch((err) => fail(msg(err)))
    },
    addEventListener(type, listener, options) {
      target.addEventListener(type, listener as EventListener, options)
    },
    removeEventListener(type, listener, options) {
      target.removeEventListener(type, listener as EventListener, options)
    },
  }
}
