import { describe, expect, test } from "bun:test"
import { createDesktopFiles } from "./files"

function fileApi(events: string[]) {
  return {
    openFilePicker: async () => ({
      token: "selection",
      files: [
        { path: "C:\\first.txt", name: "first.txt", size: 5 },
        { path: "C:\\second.txt", name: "second.txt", size: 6 },
      ],
    }),
    readPickedFile: async (_token: string, path: string) => {
      events.push(`read:${path}`)
      return new TextEncoder().encode(path).buffer
    },
    releasePickedFiles: async (token: string) => {
      events.push(`release:${token}`)
    },
  } as Parameters<typeof createDesktopFiles>[0]
}

describe("desktop attachment files", () => {
  test("reads selected files sequentially and releases the token", async () => {
    const events: string[] = []
    const files = createDesktopFiles(fileApi(events), "windows")

    await files.openAttachmentPickerDialog({}, async (file) => {
      events.push(`file:${file.name}`)
    })

    expect(events).toEqual([
      "read:C:\\first.txt",
      "file:first.txt",
      "read:C:\\second.txt",
      "file:second.txt",
      "release:selection",
    ])
  })

  test("releases the token when a selected file callback fails", async () => {
    const events: string[] = []
    const files = createDesktopFiles(fileApi(events), "windows")

    await expect(
      files.openAttachmentPickerDialog({}, async () => {
        throw new Error("attachment rejected")
      }),
    ).rejects.toThrow("attachment rejected")
    expect(events.at(-1)).toBe("release:selection")
  })
})
