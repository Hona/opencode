import type { AgentPart as MessageAgentPart, FilePart, Part, TextPart } from "@opencode-ai/sdk/v2"
import type { AgentPart, FileAttachmentPart, ImageAttachmentPart, Prompt } from "@/context/prompt"
import type { BlobReference } from "@/persistence"
import { checksum } from "@opencode-ai/core/util/encode"

const attachmentDataUrls = new Map<string, BlobReference>()

export function attachmentReferenceUrl(reference: BlobReference) {
  return `opencode-blob:${encodeURIComponent(reference.digest)}?byteLength=${reference.byteLength}`
}

export function rememberAttachmentDataUrl(url: string, reference: BlobReference) {
  const key = checksum(url)
  if (!key) return
  attachmentDataUrls.delete(key)
  attachmentDataUrls.set(key, reference)
  const oldest = attachmentDataUrls.keys().next().value
  if (attachmentDataUrls.size > 100 && oldest) attachmentDataUrls.delete(oldest)
}

function attachmentReferenceFromUrl(url: string) {
  if (!url.startsWith("opencode-blob:")) {
    const key = checksum(url)
    return key ? attachmentDataUrls.get(key) : undefined
  }
  const value = new URL(url)
  const byteLength = Number(value.searchParams.get("byteLength"))
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) return
  return { digest: decodeURIComponent(value.pathname), byteLength }
}

type Inline =
  | {
      type: "file"
      start: number
      end: number
      value: string
      path: string
      selection?: {
        startLine: number
        endLine: number
        startChar: number
        endChar: number
      }
    }
  | {
      type: "agent"
      start: number
      end: number
      value: string
      name: string
    }

function selectionFromFileUrl(url: string): Extract<Inline, { type: "file" }>["selection"] {
  const queryIndex = url.indexOf("?")
  if (queryIndex === -1) return undefined
  const params = new URLSearchParams(url.slice(queryIndex + 1))
  const startLine = Number(params.get("start"))
  const endLine = Number(params.get("end"))
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return undefined
  return {
    startLine,
    endLine,
    startChar: 0,
    endChar: 0,
  }
}

function textPartValue(parts: Part[]) {
  const candidates = parts
    .filter((part): part is TextPart => part.type === "text")
    .filter((part) => !part.synthetic && !part.ignored)
  return candidates.reduce((best: TextPart | undefined, part) => {
    if (!best) return part
    if (part.text.length > best.text.length) return part
    return best
  }, undefined)
}

/**
 * Extract prompt content from message parts for restoring into the prompt input.
 * This is used by undo to restore the original user prompt.
 */
export function extractPromptFromParts(parts: Part[], opts?: { directory?: string; attachmentName?: string }): Prompt {
  const textPart = textPartValue(parts)
  const text = textPart?.text ?? ""
  const directory = opts?.directory
  const attachmentName = opts?.attachmentName ?? "attachment"

  const toRelative = (path: string) => {
    if (!directory) return path

    const prefix = directory.endsWith("/") ? directory : directory + "/"
    if (path.startsWith(prefix)) return path.slice(prefix.length)

    if (path.startsWith(directory)) {
      const next = path.slice(directory.length)
      if (next.startsWith("/")) return next.slice(1)
      return next
    }

    return path
  }

  const inline: Inline[] = []
  const images: ImageAttachmentPart[] = []

  for (const part of parts) {
    if (part.type === "file") {
      const filePart = part as FilePart
      const sourceText = filePart.source?.text
      if (sourceText) {
        const value = sourceText.value
        const start = sourceText.start
        const end = sourceText.end
        let path = value
        if (value.startsWith("@")) path = value.slice(1)
        if (!value.startsWith("@") && filePart.source && "path" in filePart.source) {
          path = filePart.source.path
        }
        inline.push({
          type: "file",
          start,
          end,
          value,
          path: toRelative(path),
          selection: selectionFromFileUrl(filePart.url),
        })
        continue
      }

      const blob = attachmentReferenceFromUrl(filePart.url)
      if (blob) {
        images.push({
          type: "image",
          id: filePart.id,
          filename: filePart.filename ?? attachmentName,
          mime: filePart.mime,
          blob,
        })
      }
    }

    if (part.type === "agent") {
      const agentPart = part as MessageAgentPart
      const source = agentPart.source
      if (!source) continue
      inline.push({
        type: "agent",
        start: source.start,
        end: source.end,
        value: source.value,
        name: agentPart.name,
      })
    }
  }

  inline.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start
    return a.end - b.end
  })

  const result: Prompt = []
  let position = 0
  let cursor = 0

  const pushText = (content: string) => {
    if (!content) return
    result.push({
      type: "text",
      content,
      start: position,
      end: position + content.length,
    })
    position += content.length
  }

  const pushFile = (item: Extract<Inline, { type: "file" }>) => {
    const content = item.value
    const attachment: FileAttachmentPart = {
      type: "file",
      path: item.path,
      content,
      start: position,
      end: position + content.length,
      selection: item.selection,
    }
    result.push(attachment)
    position += content.length
  }

  const pushAgent = (item: Extract<Inline, { type: "agent" }>) => {
    const content = item.value
    const mention: AgentPart = {
      type: "agent",
      name: item.name,
      content,
      start: position,
      end: position + content.length,
    }
    result.push(mention)
    position += content.length
  }

  for (const item of inline) {
    if (item.start < 0 || item.end < item.start) continue

    const expected = item.value
    if (!expected) continue

    const mismatch = item.end > text.length || item.start < cursor || text.slice(item.start, item.end) !== expected
    const start = mismatch ? text.indexOf(expected, cursor) : item.start
    if (start === -1) continue
    const end = mismatch ? start + expected.length : item.end

    pushText(text.slice(cursor, start))

    if (item.type === "file") pushFile(item)
    if (item.type === "agent") pushAgent(item)

    cursor = end
  }

  pushText(text.slice(cursor))

  if (result.length === 0) {
    result.push({ type: "text", content: "", start: 0, end: 0 })
  }

  if (images.length === 0) return result
  return [...result, ...images]
}

export async function restorePromptFromParts(
  parts: Part[],
  input: {
    directory?: string
    attachmentName?: string
    putBlob: (bytes: Uint8Array) => Promise<BlobReference>
  },
) {
  const prompt = extractPromptFromParts(parts, input)
  const restored = new Set(prompt.flatMap((part) => (part.type === "image" ? [part.id] : [])))
  const images = await Promise.all(
    parts.flatMap((part) => {
      if (part.type !== "file" || part.source?.text || restored.has(part.id) || !part.url.startsWith("data:")) return []
      return [
        (async () => {
          const comma = part.url.indexOf(",")
          const decoded = atob(part.url.slice(comma + 1))
          const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0))
          return {
            type: "image" as const,
            id: part.id,
            filename: part.filename ?? input.attachmentName ?? "attachment",
            mime: part.mime,
            blob: await input.putBlob(bytes),
          }
        })(),
      ]
    }),
  )
  return images.length > 0 ? [...prompt, ...images] : prompt
}
