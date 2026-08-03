import { createEffect, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { PromptInputV2Attachment, PromptInputV2BlobReference, PromptInputV2Prompt } from "./types"

const accepted = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/*",
  "application/json",
  "application/ld+json",
  "application/toml",
  "application/x-toml",
  "application/x-yaml",
  "application/xml",
  "application/yaml",
  ".c",
  ".cc",
  ".cjs",
  ".conf",
  ".cpp",
  ".css",
  ".csv",
  ".cts",
  ".env",
  ".go",
  ".gql",
  ".graphql",
  ".h",
  ".hh",
  ".hpp",
  ".htm",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".log",
  ".md",
  ".mdx",
  ".mjs",
  ".mts",
  ".py",
  ".rb",
  ".rs",
  ".sass",
  ".scss",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]

type PromptTarget = {
  current: () => PromptInputV2Prompt
  cursor: () => number | undefined
  set: (prompt: PromptInputV2Prompt, cursor?: number) => void
}

export type PromptInputV2AttachmentConfig = {
  picker?: (
    options: { defaultPath?: string; multiple?: boolean; accept?: string[] },
    onFile: (file: File) => Promise<unknown>,
  ) => Promise<void>
  directory: () => string
  isDialogActive: () => boolean
  warn: () => void
  duplicate: () => void
  onError: (error: unknown) => void
  readClipboardImage?: () => Promise<File | null>
  getPathForFile?: (file: File) => string
  putBlob: (bytes: Uint8Array) => Promise<PromptInputV2BlobReference>
  readBlob: (reference: PromptInputV2BlobReference) => Promise<Uint8Array | null>
}

export function createPromptInputV2Attachments(
  input: PromptInputV2AttachmentConfig & {
    capture: () => PromptTarget
    editor: () => HTMLElement | undefined
    focusEditor: () => void
    addPart: (part: PromptInputV2Prompt[number]) => boolean
    setDraggingType: (type: "image" | "@mention" | null) => void
  },
) {
  const [previews, setPreviews] = createStore<Record<string, string | undefined>>({})
  const loading = new Set<string>()
  const migrating = new Set<string>()
  const revoke = (digest: string) => {
    const url = previews[digest]
    if (url) URL.revokeObjectURL(url)
    setPreviews(digest, undefined)
    loading.delete(digest)
  }
  const cachePreview = (attachment: PromptInputV2Attachment, bytes: Uint8Array) => {
    const reference = attachmentReference(attachment)
    if (!reference) return
    const previous = previews[reference.digest]
    const next = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: attachment.mime }))
    setPreviews(reference.digest, next)
    loading.delete(reference.digest)
    if (previous) URL.revokeObjectURL(previous)
  }
  const previewUrl = (attachment: PromptInputV2Attachment) => {
    const reference = attachmentReference(attachment)
    if (!reference) return
    const digest = reference.digest
    const current = previews[digest]
    if (current || loading.has(digest)) return current
    loading.add(digest)
    void input
      .readBlob(reference)
      .then((bytes) => {
        if (!bytes || previews[digest]) {
          loading.delete(digest)
          return
        }
        if (
          !input
            .capture()
            .current()
            .some((part) => part.type === "image" && attachmentReference(part)?.digest === digest)
        ) {
          loading.delete(digest)
          return
        }
        cachePreview(attachment, bytes)
      })
      .catch(() => loading.delete(digest))
    return previews[digest]
  }
  createEffect(() => {
    const target = input.capture()
    target.current().forEach((part) => {
      if (part.type !== "image") return
      const url = legacyAttachmentUrl(part)
      if (!url || migrating.has(part.id)) return
      migrating.add(part.id)
      void fetch(url)
        .then((response) => response.arrayBuffer())
        .then((buffer) => {
          const bytes = new Uint8Array(buffer)
          return input.putBlob(bytes).then((blob) => ({ bytes, blob }))
        })
        .then(({ bytes, blob }) => {
          const current = target.current()
          if (!current.some((item) => item.type === "image" && item.id === part.id && legacyAttachmentUrl(item))) return
          const attachment: PromptInputV2Attachment = {
            type: "image",
            id: part.id,
            filename: part.filename,
            sourcePath: part.sourcePath,
            mime: part.mime,
            blob,
          }
          target.set(
            current.map((item) => (item.type === "image" && item.id === part.id ? attachment : item)),
            target.cursor(),
          )
          cachePreview(attachment, bytes)
        })
        .catch(() => {})
        .finally(() => migrating.delete(part.id))
    })
    const active = new Set(
      target.current().flatMap((part) => {
        const reference = part.type === "image" ? attachmentReference(part) : undefined
        return reference ? [reference.digest] : []
      }),
    )
    Object.keys(previews).forEach((digest) => {
      if (!active.has(digest)) revoke(digest)
    })
  })
  onCleanup(() => Object.keys(previews).forEach(revoke))

  const capture = () => {
    const prompt = input.capture()
    const editor = input.editor()
    if (!editor) return
    return { prompt, cursor: prompt.cursor() ?? cursorPosition(editor) }
  }
  const add = async (file: File, toast = true, target = capture(), clipboard = false) => {
    if (!target) return false
    const mime = await attachmentMime(file)
    if (!mime) {
      if (toast) input.warn()
      return false
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const blob = await input.putBlob(bytes)
    const sourcePath = input.getPathForFile?.(file) || undefined
    const duplicate = target.prompt
      .current()
      .some(
        (part) =>
          part.type === "image" &&
          attachmentReference(part)?.digest === blob.digest &&
          (sourcePath
            ? part.sourcePath === sourcePath
            : !part.sourcePath && (clipboard || part.filename === file.name)),
      )
    if (duplicate) {
      input.duplicate()
      return true
    }
    const attachment: PromptInputV2Attachment = {
      type: "image",
      id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2),
      filename: file.name,
      sourcePath,
      mime,
      blob,
    }
    target.prompt.set([...target.prompt.current(), attachment], target.cursor)
    cachePreview(attachment, bytes)
    return true
  }
  const addAttachments = async (files: File[], toast = true, target = capture()) => {
    const found = await files.reduce(async (result, file) => {
      const previous = await result
      return (await add(file, false, target)) || previous
    }, Promise.resolve(false))
    if (!found && files.length > 0 && toast) input.warn()
    return found
  }
  const handlePaste = async (event: ClipboardEvent) => {
    const clipboardData = event.clipboardData
    if (!clipboardData) return
    const target = capture()
    if (!target) return
    event.preventDefault()
    event.stopPropagation()
    const files = Array.from(clipboardData.items).flatMap((item) => {
      if (item.kind !== "file") return []
      const file = item.getAsFile()
      return file ? [file] : []
    })
    if (files.length > 0) {
      await addAttachments(files, true, target)
      return
    }
    const plainText = clipboardData.getData("text/plain") ?? ""
    if (input.readClipboardImage && !plainText) {
      const file = await input.readClipboardImage()
      if (file && (await add(file, true, target, true))) return
    }
    if (!plainText) return
    const text = plainText.includes("\r") ? plainText.replace(/\r\n?/g, "\n") : plainText
    const put = () => {
      if (input.addPart({ type: "text", content: text, start: 0, end: 0 })) return true
      input.focusEditor()
      return input.addPart({ type: "text", content: text, start: 0, end: 0 })
    }
    if (text.includes("\n") || largePaste(text)) {
      put()
      return
    }
    if (typeof document.execCommand === "function" && document.execCommand("insertText", false, text)) return
    put()
  }
  const handleDrop = async (event: DragEvent) => {
    if (input.isDialogActive()) return
    event.preventDefault()
    input.setDraggingType(null)
    const plainText = event.dataTransfer?.getData("text/plain")
    if (plainText?.startsWith("file:")) {
      const path = plainText.slice("file:".length)
      input.focusEditor()
      input.addPart({ type: "file", path, content: `@${path}`, start: 0, end: 0 })
      return
    }
    const files = event.dataTransfer?.files
    if (files) await addAttachments(Array.from(files))
  }

  onMount(() => {
    makeEventListener(document, "dragover", (event) => {
      if (input.isDialogActive()) return
      event.preventDefault()
      if (event.dataTransfer?.types.includes("Files")) input.setDraggingType("image")
      else if (event.dataTransfer?.types.includes("text/plain")) input.setDraggingType("@mention")
    })
    makeEventListener(document, "dragleave", (event) => {
      if (!input.isDialogActive() && !event.relatedTarget) input.setDraggingType(null)
    })
    makeEventListener(document, "drop", handleDrop)
  })

  return {
    addAttachments,
    previewUrl,
    revoke,
    handlePaste,
    handleDrop,
    pick(fallback: () => void) {
      if (!input.picker) {
        fallback()
        return
      }
      void input
        .picker({ defaultPath: input.directory(), multiple: true, accept: accepted }, (file) => add(file))
        .catch(input.onError)
    },
  }
}

function attachmentReference(attachment: PromptInputV2Attachment) {
  return (attachment as PromptInputV2Attachment & { blob?: PromptInputV2BlobReference }).blob
}

function legacyAttachmentUrl(attachment: PromptInputV2Attachment) {
  const value = (attachment as PromptInputV2Attachment & { dataUrl?: unknown }).dataUrl
  return typeof value === "string" && value.startsWith("data:") ? value : undefined
}

const imageMimes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
const imageExtensions = new Map([
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
])
const textMimes = new Set([
  "application/json",
  "application/ld+json",
  "application/toml",
  "application/x-toml",
  "application/x-yaml",
  "application/xml",
  "application/yaml",
])

async function attachmentMime(file: File) {
  const type = file.type.split(";", 1)[0]?.trim().toLowerCase() ?? ""
  if (imageMimes.has(type) || type === "application/pdf") return type
  const index = file.name.lastIndexOf(".")
  const suffix = index === -1 ? "" : file.name.slice(index + 1).toLowerCase()
  const fallback = imageExtensions.get(suffix) ?? (suffix === "pdf" ? "application/pdf" : undefined)
  if ((!type || type === "application/octet-stream") && fallback) return fallback
  if (type.startsWith("text/") || textMimes.has(type) || type.endsWith("+json") || type.endsWith("+xml")) {
    return "text/plain"
  }
  const bytes = new Uint8Array(await file.slice(0, 4096).arrayBuffer())
  if (bytes.some((byte) => byte === 0)) return
  const control = bytes.filter((byte) => byte < 9 || (byte > 13 && byte < 32)).length
  if (bytes.length > 0 && control / bytes.length > 0.3) return
  return "text/plain"
}

function cursorPosition(editor: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  const range = selection.getRangeAt(0)
  if (!editor.contains(range.startContainer)) return 0
  const before = range.cloneRange()
  before.selectNodeContents(editor)
  before.setEnd(range.startContainer, range.startOffset)
  return before.toString().replace(/\u200B/g, "").length
}

function largePaste(text: string) {
  if (text.length >= 8000) return true
  return text.split("\n").length - 1 >= 120
}
