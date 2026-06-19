import { expect, test } from "bun:test"
import { compressCachedRepaintTrace, layoutShiftSample } from "../timeline/session-tab-repaint-probe"

test("compresses repeated repaint states without losing frame samples", () => {
  const state = {
    root: 1,
    scrollTop: 10,
    scrollHeight: 20,
    bottomError: 0,
    last: true,
    rows: [{ key: "row", node: 2, top: 0, bottom: 10 }],
    mounted: 1,
    center: "content",
  }
  const trace = {
    started: 100,
    frames: [
      { at: 16, ...state },
      { at: 32, ...state },
      { at: 48, ...state, scrollTop: 11 },
    ],
    mutations: [{ at: 20, changed: [{ type: "add", node: 2 }] }],
    shifts: [{ at: 24, value: 0.1 }],
    running: false,
  }
  const compressed = compressCachedRepaintTrace(trace)
  const frames = compressed.frames.flatMap((group) => group.at.map((at) => ({ at, ...group.state })))

  expect(frames).toEqual(trace.frames)
  expect(compressed.mutations).toEqual(trace.mutations)
  expect(compressed.shifts).toEqual(trace.shifts)
})

test("records layout shifts at occurrence time within the probe window", () => {
  expect(layoutShiftSample({ startTime: 99, value: 0.1 }, 100)).toBeUndefined()
  expect(layoutShiftSample({ startTime: 124, value: 0.2 }, 100)).toEqual({ at: 24, value: 0.2 })
})
