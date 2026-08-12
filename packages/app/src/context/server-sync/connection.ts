import { createEffect, type Accessor } from "solid-js"
import type { ServerConnectionStatus } from "../server-sdk"

export function createConnectionSync(input: {
  status: Accessor<ServerConnectionStatus>
  invalidate: () => void
  connected: () => void
}) {
  createEffect(() => {
    if (input.status() === "connected") return
    input.invalidate()
  })

  function main(event: { type: string; directory: string }) {
    if (event.directory !== "global" || event.type !== "server.connected") return
    input.connected()
  }

  return { main }
}
