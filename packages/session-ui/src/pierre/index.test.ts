import { describe, expect, test } from "bun:test"
import { createDefaultOptions } from "."

describe("Pierre styles", () => {
  test("preserves the OpenCode background without an override", () => {
    expect(createDefaultOptions("unified").unsafeCSS).toMatch(
      /--diffs-bg:\s*var\(\s*--opencode-diffs-bg,\s*var\(--color-background-stronger\)\s*\)/,
    )
  })
})
