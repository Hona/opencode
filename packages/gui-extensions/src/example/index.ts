import { Schema } from "effect"
import { Extension, Store } from "../sdk"
import { Counter } from "./contract"
import en from "./i18n/en"

const Pill = Schema.Struct({ shown: Schema.Boolean })

/** The guide's example: a count main keeps, shown as a titlebar pill. Not a built-in, so it never ships. */
export default Extension.define({
  id: "example",
  // The main entry provides the counter. The window entry reads it as `ctx.uses.counter`, a `Live` accessor, so the
  // window keeps working without it.
  provides: { counter: Counter },
  stores: {
    // Window state: the host loads it before the window entry's setup.
    pill: Store.global(Pill, { shown: true }),
    // Main state: only the main entry's `ctx.stores` holds it.
    count: Store.main(Schema.Number, 0),
  },
  i18n: { en },
})
