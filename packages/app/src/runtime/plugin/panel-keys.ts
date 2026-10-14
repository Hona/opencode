import type { Panel } from "@opencode/plugin/gui"

/** The key the host stores a panel tab under. */
export function panelKey(plugin: string, id: string) {
  return `${plugin}:${id}`
}

/** The stored keys the panels map with `Panel.legacy`, each to the key of the tab it is now. */
export function legacyKeys(providers: readonly { readonly plugin: string; readonly value: Panel }[]) {
  return new Map(
    providers.flatMap((item) =>
      Object.entries(item.value.legacy ?? {}).map(([key, id]) => [key, panelKey(item.plugin, id)] as const),
    ),
  )
}
