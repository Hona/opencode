import type { MainSetup } from "../sdk/main"
import { Counter } from "./contract"
import type definition from "./index"

const setup: MainSetup<typeof definition> = (ctx) => {
  // A declared main store: main storage is synchronous, so `value` is always defined.
  const count = ctx.stores.count

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
