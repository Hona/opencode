import { describe, expect, test } from "bun:test"
import { createPromptState } from "@/context/prompt"
import { createPromptSubmissionState } from "@/components/prompt-input/submission-state"

describe("prompt submission state", () => {
  test("keeps failed submission restoration with the prompt where it started", () => {
    const target = createPromptState()
    const submission = createPromptSubmissionState({
      target,
      prompt: "prompt-A",
      context: [{ type: "file" as const, path: "src/index.ts" }],
    })

    expect(submission.restore()).toEqual({
      target,
      prompt: "prompt-A",
      context: [{ type: "file", path: "src/index.ts" }],
    })
  })

  test("moves first-submit restoration and context to the promoted session", () => {
    const draft = createPromptState()
    const session = createPromptState()
    const submission = createPromptSubmissionState({
      target: draft,
      prompt: "first prompt",
      context: [{ type: "file" as const, path: "src/index.ts" }],
    })

    submission.retarget(session)

    expect(submission.restore()).toEqual({
      target: session,
      prompt: "first prompt",
      context: [{ type: "file", path: "src/index.ts" }],
    })
    expect(session.context.items()).toHaveLength(1)
    expect(session.context.items()[0]).toMatchObject({ type: "file", path: "src/index.ts" })
  })

  test("does not restore over a prompt edited after submission", () => {
    const target = createPromptState()
    target.set([{ type: "text", content: "submitted", start: 0, end: 9 }])
    const submission = createPromptSubmissionState({
      target,
      prompt: target.current(),
      context: [],
    })

    submission.clear()
    target.set([{ type: "text", content: "new draft", start: 0, end: 9 }])

    expect(submission.restore()).toBeUndefined()
    expect(target.current()[0]).toMatchObject({ type: "text", content: "new draft" })
  })
})
