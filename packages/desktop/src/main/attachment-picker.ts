import { open } from "node:fs/promises"

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export function createPickedFileAuthorizations() {
  const senders = new Map<number, Map<string, Set<string>>>()

  return {
    add(sender: number, token: string, paths: string[]) {
      const tokens = senders.get(sender) ?? new Map<string, Set<string>>()
      tokens.set(token, new Set(paths))
      senders.set(sender, tokens)
    },
    take(sender: number, token: string, path: string) {
      const tokens = senders.get(sender)
      const paths = tokens?.get(token)
      if (!paths?.delete(path)) return false
      if (paths.size > 0) return true
      tokens?.delete(token)
      if (tokens?.size === 0) senders.delete(sender)
      return true
    },
    release(sender: number, token: string) {
      const tokens = senders.get(sender)
      tokens?.delete(token)
      if (tokens?.size === 0) senders.delete(sender)
    },
  }
}

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
