import { open } from "node:fs/promises"

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export function assertAttachmentBudget(files: { size: number }[]) {
  const total = files.reduce((sum, file) => sum + file.size, 0)
  if (total <= MAX_ATTACHMENT_BYTES) return
  throw new Error(`Selected attachments exceed the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB limit`)
}

export async function readAttachment(filePath: string) {
  const file = await open(filePath, "r")
  try {
    const info = await file.stat()
    assertAttachmentBudget([info])
    const bytes = Buffer.allocUnsafe(info.size)
    let offset = 0
    while (offset < info.size) {
      const result = await file.read(bytes, offset, info.size - offset, offset)
      if (result.bytesRead === 0) break
      offset += result.bytesRead
    }
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + offset) as ArrayBuffer
  } finally {
    await file.close()
  }
}
