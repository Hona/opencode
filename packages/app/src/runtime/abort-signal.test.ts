import { describe, expect, test } from "bun:test"
import { anySignal } from "./abort-signal"

describe("anySignal", () => {
  test("aborts with the reason of the first input to abort", () => {
    const first = new AbortController()
    const second = new AbortController()
    const signal = anySignal([first.signal, second.signal])

    expect(signal.aborted).toBe(false)
    second.abort("second")
    first.abort("first")
    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBe("second")
  })

  test("is already aborted when an input already is", () => {
    const open = new AbortController()
    const signal = anySignal([open.signal, AbortSignal.abort("done")])

    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBe("done")
  })
})
