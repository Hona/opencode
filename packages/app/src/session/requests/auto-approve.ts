import { createEffect, onCleanup } from "solid-js"
import type { PermissionRequest } from "@opencode-ai/client/promise"
import type { Data } from "@opencode-ai/client/solid"
import type { ServerSDK } from "@/runtime/server/client"
import { useSettings } from "@/settings/model"

const respondedLimit = 1000
const retryLimit = 2
const retryDelayMs = 1000

// Auto-approves permission requests on one server connection whenever the
// app-level auto-approve setting is on. The setting lives in the client-local
// settings store, so it applies to every session, tab, and server at once.
export function createPermissionAutoApprover(input: { sdk: ServerSDK; data: Data }) {
  const enabled = useSettings().permissions.autoApprove
  const state = { disposed: false, responded: new Set<string>() }

  const unsubscribe = input.sdk.event.on("permission.asked", (event) => {
    if (enabled()) approve(event.data)
  })
  onCleanup(() => {
    state.disposed = true
    unsubscribe()
  })

  // The event stream does not replay requests asked while this client was
  // disconnected, and requests may already be pending before the setting turns
  // on, so sweep on every connect while the setting is on.
  createEffect(() => {
    if (!enabled() || input.sdk.connection.status() !== "connected") return
    void sweep()
  })

  async function sweep() {
    for (const location of await activeSessionLocations()) {
      input.sdk.api.permission.request
        .list({ location: { directory: location.directory, workspace: location.workspaceID } })
        .then((pending) => {
          if (state.disposed || !enabled()) return
          pending.data.forEach((request) => approve(request))
        })
        .catch(() => undefined)
    }
  }

  // Pending requests only exist inside active executions (Permission.assert
  // clears its entry when the awaiting fiber dies), and session.active is
  // server-wide, so this inventory covers sessions no tab has loaded.
  async function activeSessionLocations() {
    const active = await input.sdk.api.session.active().catch(() => ({}))
    const ids = Object.keys(active)
    await Promise.all(
      ids.filter((id) => !input.data.session.get(id)).map((id) => input.data.session.sync(id).catch(() => undefined)),
    )
    const locations = ids.flatMap((id) => {
      const location = input.data.session.get(id)?.location
      return location ? [location] : []
    })
    return [...new Map(locations.map((item) => [`${item.directory}\u0000${item.workspaceID ?? ""}`, item])).values()]
  }

  function approve(permission: PermissionRequest, attempt = 0) {
    if (state.disposed || state.responded.has(permission.id)) return
    remember(permission.id)
    input.sdk.api.permission
      .reply({ sessionID: permission.sessionID, requestID: permission.id, reply: "once" })
      .catch(() => {
        // A reply failure leaves the request pending but invisible (the UI
        // hides prompts while auto-approve is on), so retry a bounded number
        // of times. Sweeps on reconnect or re-enable retry it after that.
        state.responded.delete(permission.id)
        if (state.disposed || !enabled() || attempt >= retryLimit) return
        setTimeout(() => approve(permission, attempt + 1), retryDelayMs * (attempt + 1))
      })
  }

  function remember(id: string) {
    state.responded.add(id)
    for (const oldest of state.responded) {
      if (state.responded.size <= respondedLimit) break
      state.responded.delete(oldest)
    }
  }
}
