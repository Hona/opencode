import { Schema } from "effect"
import { Extension, Store } from "../sdk"
import { Counter } from "./contract"
import en from "./i18n/en"

const Pill = Schema.Struct({ shown: Schema.Boolean })

/** The guide's example: a count main keeps, shown as a titlebar pill. Not a built-in, so it never ships. */
export default Extension.define({
  id: "example",
  // The main entry provides the counter and the window entry uses it, so the window keeps working without it.
  provides: { counter: Counter },
  uses: { counter: Counter },
  stores: { pill: Store.global(Pill, { shown: true }) },
  i18n: { en },
})
