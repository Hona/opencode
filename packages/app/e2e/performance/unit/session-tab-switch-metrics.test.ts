import { expect, test } from "bun:test"
import { classifySessionSwitch } from "../timeline/session-tab-switch-metrics"

test("counts source and blank samples before the destination is observed", () => {
  const result = classifySessionSwitch([
    { observedAtMs: 16, destination: [], source: ["source"], last: false },
    { observedAtMs: 32, destination: [], source: [], last: false },
    { observedAtMs: 48, destination: ["destination"], source: [], last: true, bottomErrorPx: 0 },
    { observedAtMs: 64, destination: ["destination"], source: [], last: true, bottomErrorPx: 0 },
    { observedAtMs: 80, destination: ["destination"], source: [], last: true, bottomErrorPx: 0 },
  ])

  expect(result.blankSamples).toBe(1)
  expect(result.sourceSamples).toBe(1)
  expect(result.firstDestinationObservedMs).toBe(48)
  expect(result.stableObservedMs).toBe(80)
})
