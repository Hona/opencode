import { describe, expect, test } from "bun:test"
import { commentContextItem, readPromptPresentation } from "./comment-note"

const browser = {
  type: "browser" as const,
  tabID: "tab_00000000-0000-4000-8000-000000000000",
  url: "http://localhost:5173/",
  element: { ref: "e42", selector: "#save", label: "button#save" },
  comment: "Rename this",
}

describe("browser element comments", () => {
  test("read from message metadata beside file comments and skip malformed entries", () => {
    const value = readPromptPresentation({
      displayText: "hi",
      comments: [browser, { ...browser, element: { label: "button" } }, { path: "src/app.ts", comment: "Keep" }],
    })
    expect(value?.comments).toEqual([browser, { path: "src/app.ts", comment: "Keep" }])
  })

  test("return to the composer without their element ref", () => {
    expect(commentContextItem(browser)).toEqual({
      ...browser,
      element: { selector: "#save", label: "button#save" },
      commentID: expect.any(String),
    })
  })
})
