import type { Platform } from "@opencode-ai/app"
import type { SocketEvt, SocketHead } from "../preload/types"

export const socket: NonNullable<Platform["socket"]> = (url, opts) => {
  const target = new EventTarget()
  const heads: SocketHead[] = Object.entries(opts?.headers ?? {}).map(([name, value]) => ({ name, value }))
  let mode: BinaryType = "arraybuffer"
  let id = ""
  let state: number = WebSocket.CONNECTING
  let done = false

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

  const on = (evt: SocketEvt) => {
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
        const data = mode === "blob" ? new Blob([evt.data]) : evt.data
        target.dispatchEvent(new MessageEvent("message", { data }))
        return
      }
      case "error": {
        if (done) return
        target.dispatchEvent(new Event("error"))
        return
      }
      case "close": {
        close(evt.code ?? 1000, evt.reason ?? "", evt.clean)
      }
    }
  }

  try {
    id = window.api.openSocket(url, heads, on)
  } catch (err) {
    queueMicrotask(() => fail(err instanceof Error ? err.message : String(err)))
  }

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
      window.api.writeSocket(id, data)
    },
    close(code?: number, reason?: string) {
      if (done || state === WebSocket.CLOSING) return
      state = WebSocket.CLOSING
      if (!id) {
        close(code ?? 1000, reason ?? "")
        return
      }
      window.api.closeSocket(id, code ?? null, reason ?? null)
    },
    addEventListener(type, listener, options) {
      target.addEventListener(type, listener as EventListener, options)
    },
    removeEventListener(type, listener, options) {
      target.removeEventListener(type, listener as EventListener, options)
    },
  }
}
