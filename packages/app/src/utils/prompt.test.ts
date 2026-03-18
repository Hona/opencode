import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2"
import { extractPromptFromParts } from "./prompt"

describe("extractPromptFromParts", () => {
  test("restores workspace-relative file paths across windows path variants", () => {
    const parts: Part[] = [
      {
        id: "text_1",
        sessionID: "ses_1",
        messageID: "msg_1",
        type: "text",
        text: "Check @src\\app.ts",
      },
      {
        id: "file_1",
        sessionID: "ses_1",
        messageID: "msg_1",
        type: "file",
        mime: "text/plain",
        url: "file:///C:/Repo/src/app.ts?start=3&end=5",
        source: {
          type: "file",
          path: "C:\\Repo\\src\\app.ts",
          text: {
            value: "@src\\app.ts",
            start: 6,
            end: 17,
          },
        },
      },
    ]

    const prompt = extractPromptFromParts(parts, { directory: "c:/repo" })
    const file = prompt.find((part) => part.type === "file")

    expect(file).toMatchObject({
      type: "file",
      path: "src\\app.ts",
      selection: { startLine: 3, endLine: 5, startChar: 0, endChar: 0 },
    })
  })

  test("keeps absolute file paths outside the workspace", () => {
    const parts: Part[] = [
      {
        id: "text_1",
        sessionID: "ses_1",
        messageID: "msg_1",
        type: "text",
        text: "Check @D:\\other\\app.ts",
      },
      {
        id: "file_1",
        sessionID: "ses_1",
        messageID: "msg_1",
        type: "file",
        mime: "text/plain",
        url: "file:///D:/other/app.ts",
        source: {
          type: "file",
          path: "D:\\other\\app.ts",
          text: {
            value: "@D:\\other\\app.ts",
            start: 6,
            end: 22,
          },
        },
      },
    ]

    const prompt = extractPromptFromParts(parts, { directory: "C:/repo" })
    const file = prompt.find((part) => part.type === "file")

    expect(file).toMatchObject({
      type: "file",
      path: "D:\\other\\app.ts",
    })
  })
})
