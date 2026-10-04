import { createMemo, createResource, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { Bridge, Installed } from "@opencode/gui-extensions/sdk/bridge"

/** The extensions main reports to this window: the initial list, then every list it pushes. */
export function createInstalled(bridge: Bridge | undefined, initial?: Promise<readonly string[]>) {
  const [state, setState] = createStore<{ list?: readonly Installed[] }>({})
  // A pushed list is newer than the initial reply, so a reply that arrives after one is dropped.
  const pushed = { count: 0 }
  const [disabled] = createResource(async () => new Set(await initial))

  // Metadata still loads for settings and failure reporting, but activation only needs the preload's ids.
  createResource(async () => {
    if (!bridge) return

    const seen = pushed.count
    const list = await bridge.manager.list()

    if (pushed.count === seen) setState("list", reconcile([...list]))
  })

  if (bridge)
    onCleanup(
      bridge.on((message) => {
        if (message.type !== "extensions") return
        pushed.count++
        setState("list", reconcile([...message.list]))
      }),
    )

  return {
    disabled: createMemo(() =>
      state.list ? new Set(state.list.flatMap((item) => (item.enabled ? [] : [item.id]))) : disabled.latest,
    ),
    list: () => state.list ?? [],
  }
}
