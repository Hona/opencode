import { describe, expect, test } from "bun:test"
import { createPromptInputEditCommand, createPromptInputEditSlot, type PromptInputEdit } from "./edit"

const edit = (id: string): PromptInputEdit => ({
  id,
  prompt: [{ type: "text", content: id, start: 0, end: id.length }],
  context: [],
})

describe("prompt input edit slot", () => {
  test("loads a durable edit already present when the command mounts", () => {
    const loaded: string[] = []
    const slot = createPromptInputEditSlot(() => edit("persisted"))

    slot.mount({ load: (value) => loaded.push(value.id) })

    expect(loaded).toEqual(["persisted"])
  })
})

describe("prompt input edit command", () => {
  test("cancels replaced and disposed focus work", () => {
    const callbacks = new Map<number, () => void>()
    const cancelled: number[] = []
    const applied: string[] = []
    const focused: string[] = []
    const loaded: string[] = []
    let id = 0
    const command = createPromptInputEditCommand({
      apply: (value) => applied.push(value.id),
      focus: (value) => focused.push(value.id),
      loaded: () => loaded.push("loaded"),
      schedule: (callback) => {
        id += 1
        callbacks.set(id, callback)
        return id
      },
      cancel: (value) => {
        cancelled.push(value)
        callbacks.delete(value)
      },
    })

    command.load(edit("first"))
    command.load(edit("second"))
    callbacks.get(1)?.()
    callbacks.get(2)?.()
    command.load(edit("disposed"))
    command.dispose()
    callbacks.get(3)?.()

    expect(applied).toEqual(["first", "second", "disposed"])
    expect(focused).toEqual(["second"])
    expect(loaded).toEqual(["loaded", "loaded", "loaded"])
    expect(cancelled).toEqual([1, 3])
  })
})
