import { randomUUID } from "node:crypto"
import WebSocket from "ws"
import type { SocketEvt, SocketHead } from "./types"

type Entry = {
  ws: WebSocket
  bad: boolean
}

const map = new Map<string, Entry>()

const text = (data: WebSocket.RawData) => {
  if (typeof data === "string") return data
  if (Buffer.isBuffer(data)) return data.toString()
  if (Array.isArray(data)) return Buffer.concat(data).toString()
  return Buffer.from(data).toString()
}

const binary = (data: WebSocket.RawData) => {
  const buf = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)
  return Uint8Array.from(buf).buffer
}

const init = (headers: SocketHead[]) =>
  Object.fromEntries(headers.map((item) => [item.name, item.value])) satisfies Record<string, string>

export const socket = {
  open(url: string, headers: SocketHead[], cb: (event: SocketEvt) => void) {
    const id = randomUUID()
    const ws = new WebSocket(url, { headers: init(headers) })
    const state: Entry = { ws, bad: false }
    map.set(id, state)

    ws.on("open", () => cb({ type: "open" }))
    ws.on("message", (data, isBinary) => {
      if (!map.has(id)) return
      if (!isBinary) {
        cb({ type: "text", data: text(data) })
        return
      }
      cb({ type: "binary", data: binary(data) })
    })
    ws.on("error", (err) => {
      const state = map.get(id)
      if (!state) return
      state.bad = true
      cb({ type: "error", message: err.message })
    })
    ws.on("close", (code, reason) => {
      const state = map.get(id)
      map.delete(id)
      cb({
        type: "close",
        code,
        reason: reason.length ? Buffer.from(reason).toString() : null,
        clean: !state?.bad,
      })
    })

    return id
  },
  write(id: string, data: string) {
    const ws = map.get(id)?.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(data)
  },
  close(id: string, code?: number | null, reason?: string | null) {
    const ws = map.get(id)?.ws
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) return
    ws.close(code ?? 1000, reason ?? undefined)
  },
  shutdown() {
    for (const [id, item] of map) {
      map.delete(id)
      item.ws.close(1000)
    }
  },
}
