import { expect, test } from "bun:test"
import { createSelectionReplay } from "./selection-bridge"

test("replays a selection received before the viewer is ready", () => {
  const selected = { start: 4, end: 6 }
  const applied: Array<typeof selected | null> = []
  const selection = createSelectionReplay<typeof selected | null>(null)
  let ready = false
  const apply = (value: typeof selected | null) => {
    if (!ready) return
    applied.push(value)
  }

  selection.set(selected, apply)
  expect(applied).toEqual([])

  ready = true
  selection.replay(apply)
  expect(applied).toEqual([selected])
})
