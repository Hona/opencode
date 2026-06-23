import type { VirtualItem } from "@tanstack/solid-virtual"

export function mapVirtualItems(items: VirtualItem[]) {
  return new Map(items.flatMap((item) => [[item.key, item] as const]))
}
