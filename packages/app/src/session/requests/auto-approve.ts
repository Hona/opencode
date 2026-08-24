import { createEffect, createMemo, onCleanup } from "solid-js"
import type { PermissionRequest } from "@opencode-ai/client/promise"
import type { Data } from "@opencode-ai/client/solid"
import type { ServerSDK } from "@/runtime/server/client"
import { useSettings } from "@/settings/model"

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

  // Requests that were already pending when the setting turned on (or when
  // this client connected) never reach the event handler, so sweep every known
  // session directory while the setting is on.
  const directories = createMemo(
    () => [...new Set(input.data.session.list().map((session) => session.location.directory))].sort(),
    undefined,
    { equals: (previous, next) => previous.join("\n") === next.join("\n") },
  )
  createEffect(() => {
    if (!enabled()) return
    directories().forEach(sweep)
  })

  function approve(permission: PermissionRequest) {
    if (state.disposed || state.responded.has(permission.id)) return
    state.responded.add(permission.id)
    input.sdk.api.permission
      .reply({ sessionID: permission.sessionID, requestID: permission.id, reply: "once" })
      .catch(() => state.responded.delete(permission.id))
  }

  function sweep(directory: string) {
    input.sdk.api.permission.request
      .list({ location: { directory } })
      .then((pending) => {
        if (state.disposed || !enabled()) return
        pending.data.forEach(approve)
      })
      .catch(() => undefined)
  }
}
