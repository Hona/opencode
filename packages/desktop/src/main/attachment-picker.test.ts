import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assertAttachmentBudget, MAX_ATTACHMENT_BYTES, readAttachment } from "./attachment-picker"

describe("assertAttachmentBudget", () => {
  test("accepts selections within the media ingest limit", () => {
    expect(() => assertAttachmentBudget([{ size: MAX_ATTACHMENT_BYTES / 2 }, { size: MAX_ATTACHMENT_BYTES / 2 }])).not.toThrow()
  })

  test("rejects the selection before files are read when its total exceeds the limit", () => {
    expect(() => assertAttachmentBudget([{ size: MAX_ATTACHMENT_BYTES }, { size: 1 }])).toThrow("20 MB limit")
  })

  test("reads an approved file through a bounded buffer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-attachment-"))
    const file = join(directory, "example.txt")
    try {
      await writeFile(file, "lorem ipsum")
      expect(new TextDecoder().decode(await readAttachment(file))).toBe("lorem ipsum")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("rejects an oversized file before allocating its contents", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-attachment-"))
    const file = join(directory, "oversized.txt")
    try {
      await writeFile(file, "")
      await truncate(file, MAX_ATTACHMENT_BYTES + 1)
      await expect(readAttachment(file)).rejects.toThrow("20 MB limit")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
