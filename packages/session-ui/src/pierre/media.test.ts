import { expect, test } from "bun:test"
import { svgMediaError } from "./media"

test("classifies an initially unusable SVG value as an SVG error", () => {
  expect(svgMediaError("not an svg")).toEqual({ kind: "svg" })
  expect(svgMediaError(undefined)).toBeUndefined()
})

test("accepts SVG source records and data URLs", () => {
  expect(svgMediaError({ content: "<svg></svg>", mimeType: "image/svg+xml" })).toBeUndefined()
  expect(svgMediaError("data:image/svg+xml,%3Csvg%3E%3C/svg%3E")).toBeUndefined()
})
