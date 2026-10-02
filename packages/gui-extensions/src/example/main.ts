import { Schema } from "effect"
import type { MainSetup } from "../sdk/main"
import { Counter } from "./contract"

const setup: MainSetup = (ctx) => {
  // Main storage is synchronous: `value` is always defined.
  const count = ctx.storage.store("count", { schema: Schema.Number, initial: 0 })

  const counter = ctx.provide(Counter, {
    state: () => count.value,
    add: (by) => {
      count.update((value) => value + by)
      counter.changed()

      return count.value
    },
    reset: () => {
      count.update(() => 0)
      counter.changed()
    },
  })
}

export default setup
