import { describe, expect, test } from "bun:test"
import { migrateFileViewState } from "./view-cache"

describe("migrateFileViewState", () => {
  test("normalizes persisted file-view payload keys once", () => {
    expect(
      migrateFileViewState("C:\\repo", {
        file: {
          "src\\a.ts": { scrollTop: 10 },
          "file://C:/repo/src/a.ts": { scrollLeft: 20 },
          "C:/repo/src/b.ts": { selectedLines: { start: 4, end: 2, side: "additions" } },
          invalid: null,
        },
      }),
    ).toEqual({
      file: {
        "src/a.ts": { scrollTop: 10, scrollLeft: 20 },
        "src/b.ts": { selectedLines: { start: 4, end: 2, side: "additions" } },
      },
    })
  })
})
