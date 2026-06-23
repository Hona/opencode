import { expect, test } from "bun:test"
import { filterVirtualIndexes } from "./virtual-items"

test("removes pinned indexes left behind after the timeline shrinks", () => {
  expect(filterVirtualIndexes([0, 2, 4, 8], 5)).toEqual([0, 2, 4])
})
