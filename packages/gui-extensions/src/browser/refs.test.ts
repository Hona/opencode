import { expect, test } from "bun:test"
import { Schema } from "effect"
import type { Storage } from "../sdk/main"
import { createRefs } from "./refs"

test("element refs stay unique when the pane's main entry reloads over the same storage", () => {
  const values = new Map<string, unknown>()

  // Keeps each value as its schema encodes it, as the host's storage does.
  const storage: Storage = {
    store: (key, options) => {
      const read = () => (values.has(key) ? Schema.decodeUnknownSync(options.schema)(values.get(key)) : options.initial)

      return {
        get value() {
          return read()
        },
        ready: () => true,
        // Like the host's: a mutation that returns a value replaces the stored one.
        update: (mutation: (draft: typeof options.initial) => typeof options.initial | undefined) => {
          const current = read()
          const next = mutation(current)

          values.set(key, Schema.encodeUnknownSync(options.schema)(next === undefined ? current : next))
        },
      }
    },
    remove: (key) => {
      values.delete(key)
    },
  }

  const before = createRefs(storage)
  const issued = [before(), before()]
  const after = createRefs(storage)
  expect(issued).toEqual(["e1", "e2"])
  expect(issued).not.toContain(after())
})
