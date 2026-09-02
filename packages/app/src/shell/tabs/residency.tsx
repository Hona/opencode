import { createEffect, untrack } from "solid-js"
import type { Data } from "@opencode-ai/client/solid"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useTabs, type Tab } from "./tabs"

// Release heavy transcript and inbox data once no titlebar tab can show a session family. The
// session route always has a tab, so a tab leaving the store is the last UI surface closing.
// Metadata, family, status, permissions, and forms stay for Home rows and tab attention, and
// the client keeps unacknowledged submissions until they settle.
export function createTabResidency(input: {
  tabs: () => readonly Tab[]
  session: (server: ServerConnection.Key) => Pick<Data["session"], "root" | "evict"> | undefined
}) {
  let previous = new Map<ServerConnection.Key, Set<string>>()
  createEffect(() => {
    const current = new Map<ServerConnection.Key, Set<string>>()
    for (const tab of input.tabs()) {
      if (tab.type !== "session") continue
      const ids = current.get(tab.server) ?? new Set<string>()
      ids.add(tab.sessionId)
      if (tab.routeSessionId) ids.add(tab.routeSessionId)
      current.set(tab.server, ids)
    }
    const closed = [...previous].flatMap(([server, ids]) =>
      [...ids].filter((id) => !current.get(server)?.has(id)).map((id) => ({ server, id })),
    )
    previous = current
    untrack(() => {
      for (const server of new Set(closed.map((entry) => entry.server))) {
        const session = input.session(server)
        if (!session) continue
        const open = new Set([...(current.get(server) ?? [])].map((id) => session.root(id)))
        const roots = new Set(closed.filter((entry) => entry.server === server).map((entry) => session.root(entry.id)))
        for (const root of roots) {
          if (!open.has(root)) session.evict(root)
        }
      }
    })
  })
}

export function TabResidency() {
  const tabs = useTabs()
  const global = useGlobal()
  createTabResidency({
    tabs: () => tabs.store,
    session: (server) => {
      const conn = global.servers.list().find((item) => ServerConnection.key(item) === server)
      return conn ? global.ensureServerCtx(conn).data.session : undefined
    },
  })
  return null
}
