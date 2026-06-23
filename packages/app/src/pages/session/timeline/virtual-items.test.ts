import { expect, test } from "bun:test"
import type { VirtualItem } from "@tanstack/solid-virtual"
import { mapVirtualItems } from "./virtual-items"

test("maps virtual items when the virtualizer returns a sparse array", () => {
  const item = { key: "row-1" } as VirtualItem
  const items = new Array<VirtualItem>(2)
  items[1] = item

  expect([...mapVirtualItems(items)]).toEqual([["row-1", item]])
})
