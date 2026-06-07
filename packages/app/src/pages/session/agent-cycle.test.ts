import { describe, expect, test } from "bun:test"
import { agentCycleDisabled } from "./agent-cycle"

describe("agentCycleDisabled", () => {
  test("disables agent cycling when custom agents are hidden in desktop v2", () => {
    expect(agentCycleDisabled(true, false)).toBe(true)
  })

  test("allows agent cycling when custom agents are shown", () => {
    expect(agentCycleDisabled(true, true)).toBe(false)
  })

  test("allows agent cycling outside desktop v2", () => {
    expect(agentCycleDisabled(false, false)).toBe(false)
  })
})
