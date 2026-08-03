import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2"
import { extractPromptFromParts, rememberAttachmentDataUrl, restorePromptFromParts } from "./prompt"

describe("extractPromptFromParts", () => {
  test("restores multiple uploaded attachments", () => {
    const parts = [
      {
        id: "text_1",
        type: "text",
        text: "check these",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
      {
        id: "file_1",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,AAA",
        filename: "a.png",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
      {
        id: "file_2",
        type: "file",
        mime: "application/pdf",
        url: "data:application/pdf;base64,BBB",
        filename: "b.pdf",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
    ] satisfies Part[]

    rememberAttachmentDataUrl("data:image/png;base64,AAA", { digest: "a", byteLength: 3 })
    rememberAttachmentDataUrl("data:application/pdf;base64,BBB", { digest: "b", byteLength: 3 })
    const result = extractPromptFromParts(parts)

    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ type: "text", content: "check these" })
    expect(result.slice(1)).toMatchObject([
      { type: "image", filename: "a.png", mime: "image/png", blob: { digest: "a", byteLength: 3 } },
      { type: "image", filename: "b.pdf", mime: "application/pdf", blob: { digest: "b", byteLength: 3 } },
    ])
  })

  test("stores historical data URLs when the process has no attachment mapping", async () => {
    const parts = [
      {
        id: "file_restart",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,AP8Q",
        filename: "restart.png",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
    ] satisfies Part[]
    const stored: Uint8Array[] = []

    const result = await restorePromptFromParts(parts, {
      putBlob: async (bytes) => {
        stored.push(bytes)
        return { digest: "restored", byteLength: bytes.byteLength }
      },
    })

    expect(stored).toEqual([new Uint8Array([0, 255, 16])])
    expect(result).toEqual([
      {
        type: "text",
        content: "",
        start: 0,
        end: 0,
      },
      {
        type: "image",
        id: "file_restart",
        filename: "restart.png",
        mime: "image/png",
        blob: { digest: "restored", byteLength: 3 },
      },
    ])
  })
})
