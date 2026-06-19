import { expect, test } from "bun:test"
import { classifySessionSwitch } from "../timeline/session-tab-switch-metrics"

test("counts source and blank frames before the destination paints", () => {
  const result = classifySessionSwitch([
    { at: 16, destination: [], source: ["source"], last: false },
    { at: 32, destination: [], source: [], last: false },
    { at: 48, destination: ["destination"], source: [], last: true, bottomError: 0 },
    { at: 64, destination: ["destination"], source: [], last: true, bottomError: 0 },
    { at: 80, destination: ["destination"], source: [], last: true, bottomError: 0 },
  ])

  expect(result.blankFrames).toBe(1)
  expect(result.sourceFrames).toBe(1)
  expect(result.firstDestinationMs).toBe(48)
  expect(result.stableMs).toBe(80)
})
