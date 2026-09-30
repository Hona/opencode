import { describe, expect, test } from "bun:test"
import { commentContextItem, readPromptPresentation } from "./comment-note"

const durable = {
  type: "note" as const,
  origin: "example",
  label: "button#save",
  icon: "select-element",
  subject: 'the "button#save" element',
  href: "tab_00000000-0000-4000-8000-000000000000",
  comment: "Rename this",
}
const note = { ...durable, live: { subject: 'the "button#save" element (browser ref @e42)' } }

describe("extension notes", () => {
  test("read from message metadata beside file comments and skip malformed entries", () => {
    const value = readPromptPresentation({
      displayText: "hi",
      comments: [note, { ...note, label: 42 }, { path: "src/app.ts", comment: "Keep" }],
    })
    expect(value?.comments).toEqual([note, { path: "src/app.ts", comment: "Keep" }])
  })

  test("return to the composer without their live part", () => {
    expect(commentContextItem(note)).toEqual({ ...durable, commentID: expect.any(String) })
  })
})
