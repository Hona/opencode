import { expect, test } from "bun:test"
import { streamProgress } from "../timeline/session-timeline-stream-probe"

test("classifies emitted stream markers using the fixture cycle", () => {
  expect(streamProgress("before stream-17 after stream-18")).toEqual({ index: 18, phase: "boundary" })
  expect(streamProgress("before stream-18 after stream-19")).toEqual({ index: 19, phase: "code" })
  expect(streamProgress("benchmark-complete stream-36")).toEqual({ index: 36, phase: "complete" })
  expect(streamProgress("no marker")).toEqual({ index: -1, phase: "unknown" })
})
