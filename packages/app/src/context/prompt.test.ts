import { beforeAll, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import type { Prompt } from "./prompt"

let createPromptSessionForTest: typeof import("./prompt").createPromptSessionForTest
let isPromptEqual: typeof import("./prompt").isPromptEqual

beforeAll(async () => {
  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => ({}),
  }))
  mock.module("@opencode-ai/ui/context", () => ({
    createSimpleContext: () => ({
      use: () => undefined,
      provider: () => undefined,
    }),
  }))
  const mod = await import("./prompt")
  createPromptSessionForTest = mod.createPromptSessionForTest
  isPromptEqual = mod.isPromptEqual
})

describe("prompt file path state", () => {
  test("treats file prompt parts with slash variants as equal", () => {
    const a: Prompt = [{ type: "file", path: "src\\a.ts", content: "@src/a.ts", start: 0, end: 9 }]
    const b: Prompt = [{ type: "file", path: "src/a.ts", content: "@src/a.ts", start: 0, end: 9 }]
    expect(isPromptEqual(a, b)).toBe(true)
  })

  test("updates and removes comment context items across slash variants", () => {
    createRoot((dispose) => {
      const prompt = createPromptSessionForTest({
        context: {
          items: [
            {
              key: "legacy",
              type: "file",
              path: "src\\a.ts",
              commentID: "c1",
              comment: "note",
            },
          ],
        },
      })

      prompt.context.updateComment("src/a.ts", "c1", { comment: "edited" })
      expect(prompt.context.items()[0]?.comment).toBe("edited")

      prompt.context.removeComment("src\\a.ts", "c1")
      expect(prompt.context.items()).toEqual([])

      dispose()
    })
  })
})
