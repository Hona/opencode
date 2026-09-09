import { createMemo, createRoot, getOwner, onCleanup, untrack, type Accessor, type JSX } from "solid-js"
import { createScopedCache } from "@/runtime/server/scoped-cache"
import type { TimelineSessionSource } from "./controller"

export function createTimelineCache(
  session: TimelineSessionSource & { identity: { workspaceKey: Accessor<string> } },
  render: (source: TimelineSessionSource, active: Accessor<boolean>) => JSX.Element,
  visible: Accessor<boolean>,
) {
  const owner = getOwner()
  let workspace = untrack(session.identity.workspaceKey)
  const cache = createScopedCache(
    (key) =>
      createRoot((dispose) => {
        const id = untrack(session.identity.sessionID)
        const sessionKey = untrack(session.identity.sessionKey)
        const active = createMemo(() => visible() && session.identity.sessionKey() === key)
        // A detached view retains its own inputs until it is selected again.
        const select = <T>(read: Accessor<T>) =>
          createMemo<T>((previous) => (active() ? read() : previous), untrack(read))
        return {
          value: render(
            {
              identity: {
                params: session.identity.params,
                sessionID: () => id,
                sessionKey: () => sessionKey,
              },
              data: {
                info: select(session.data.info),
                parent: select(session.data.parent),
                parentID: select(session.data.parentID),
                status: select(session.data.status),
              },
              history: { messages: select(session.history.messages) },
            },
            active,
          ),
          dispose,
        }
      }, owner),
    { maxEntries: 16, dispose: (entry) => entry.dispose() },
  )
  onCleanup(cache.clear)
  return () => {
    const next = session.identity.workspaceKey()
    // Tool and Markdown providers follow the selected Location. Detached views
    // must not retain those providers across a directory change.
    if (next !== workspace) {
      cache.clear()
      workspace = next
    }
    return cache.get(session.identity.sessionKey()).value
  }
}
