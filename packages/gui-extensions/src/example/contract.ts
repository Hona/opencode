import { Schema } from "effect"
import { Ipc } from "../sdk"

/** A count the main process keeps for the whole app; every window sees the same value. */
export const Counter = Ipc.define({
  id: "example.counter",
  state: Schema.Number,
  methods: {
    /** Adds a number to the count and returns the new count. */
    add: { input: Schema.Number, output: Schema.Number },
    /** Sets the count back to 0. */
    reset: {},
  },
})
