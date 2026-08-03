import { createEffect, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { showToast } from "@/utils/toast"
import { type ContentPart, type ImageAttachmentPart, type usePrompt } from "@/context/prompt"
import type { BlobReference } from "@/persistence"
import { useLanguage } from "@/context/language"
import { uuid } from "@/utils/uuid"
import { getCursorPosition } from "./editor-dom"
import { attachmentMime } from "./files"
import { normalizePaste, pasteMode } from "./paste"

type PromptTarget = Pick<ReturnType<ReturnType<typeof usePrompt>["capture"]>, "current" | "cursor" | "set">
type AttachmentTarget = { prompt: PromptTarget; cursor: number | undefined }

type PromptAttachmentsCoreInput = {
  capture: () => PromptTarget
  editor: () => HTMLDivElement | undefined
  focusEditor?: () => void
  addPart?: (part: ContentPart) => boolean
  warn?: () => void
  readClipboardImage?: () => Promise<File | null>
  getPathForFile?: (file: File) => string
  putBlob: (bytes: Uint8Array) => Promise<BlobReference>
  readBlob: (reference: BlobReference) => Promise<Uint8Array | null>
  duplicate?: () => void
}

export type PromptAttachmentsInput = {
  prompt: ReturnType<typeof usePrompt>
  editor: () => HTMLDivElement | undefined
  isDialogActive: () => boolean
  setDraggingType: (type: "image" | "@mention" | null) => void
  focusEditor: () => void
  addPart: (part: ContentPart) => boolean
  readClipboardImage?: () => Promise<File | null>
  getPathForFile?: (file: File) => string
  putBlob: (bytes: Uint8Array) => Promise<BlobReference>
  readBlob: (reference: BlobReference) => Promise<Uint8Array | null>
}

export function createPromptAttachmentsCore(input: PromptAttachmentsCoreInput) {
  const [previews, setPreviews] = createStore<Record<string, string | undefined>>({})
  const loading = new Set<string>()
  const migrating = new Set<string>()
  const revokePreview = (digest: string) => {
    const url = previews[digest]
    if (url) URL.revokeObjectURL(url)
    setPreviews(digest, undefined)
    loading.delete(digest)
  }
  const cachePreview = (attachment: ImageAttachmentPart, bytes: Uint8Array) => {
    const reference = attachmentReference(attachment)
    if (!reference) return
    const previous = previews[reference.digest]
    const next = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: attachment.mime }))
    setPreviews(reference.digest, next)
    loading.delete(reference.digest)
    if (previous) URL.revokeObjectURL(previous)
  }
  const previewUrl = (attachment: ImageAttachmentPart) => {
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
          const attachment: ImageAttachmentPart = {
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
      if (!active.has(digest)) revokePreview(digest)
    })
  })
  onCleanup(() => Object.keys(previews).forEach(revokePreview))

  const capture = (): AttachmentTarget | undefined => {
    const prompt = input.capture()
    const editor = input.editor()
    if (!editor) return
    return { prompt, cursor: prompt.cursor() ?? getCursorPosition(editor) }
  }

  const add = async (file: File, toast = true, target = capture()) => {
    if (!target) return false
    const mime = await attachmentMime(file)
    if (!mime) {
      if (toast) input.warn?.()
      return false
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const blob = await input.putBlob(bytes)
    if (
      target.prompt.current().some((part) => part.type === "image" && attachmentReference(part)?.digest === blob.digest)
    ) {
      input.duplicate?.()
      return true
    }

    const attachment: ImageAttachmentPart = {
      type: "image",
      id: uuid(),
      filename: file.name,
      sourcePath: input.getPathForFile?.(file) || undefined,
      mime,
      blob,
    }
    target.prompt.set([...target.prompt.current(), attachment], target.cursor)
    cachePreview(attachment, bytes)
    return true
  }

  const addAttachment = (file: File) => add(file)

  const addAttachments = async (files: File[], toast = true, target = capture()) => {
    let found = false

    for (const file of files) {
      const ok = await add(file, false, target)
      if (ok) found = true
    }

    if (!found && files.length > 0 && toast) input.warn?.()
    return found
  }

  const addClipboardAttachment = async (pending: Promise<File | null>, target = capture()) => {
    const file = await pending
    if (!file) return false
    return add(file, true, target)
  }

  const removeAttachment = (id: string) => {
    const target = input.capture()
    const current = target.current()
    const attachment = current.find((part): part is ImageAttachmentPart => part.type === "image" && part.id === id)
    const reference = attachment ? attachmentReference(attachment) : undefined
    if (reference) revokePreview(reference.digest)
    const next = current.filter((part) => part.type !== "image" || part.id !== id)
    target.set(next, target.cursor())
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

    // Desktop: Browser clipboard has no images and no text, try platform's native clipboard for images
    if (input.readClipboardImage && !plainText) {
      if (await addClipboardAttachment(input.readClipboardImage(), target)) return
    }

    if (!plainText) return

    const text = normalizePaste(plainText)

    const put = () => {
      if (input.addPart?.({ type: "text", content: text, start: 0, end: 0 })) return true
      input.focusEditor?.()
      return input.addPart?.({ type: "text", content: text, start: 0, end: 0 }) ?? false
    }

    if (pasteMode(text) === "manual") {
      put()
      return
    }

    const inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, text)
    if (inserted) return

    put()
  }

  return {
    addAttachment,
    addAttachments,
    addClipboardAttachment,
    removeAttachment,
    previewUrl,
    handlePaste,
  }
}

function attachmentReference(attachment: ImageAttachmentPart) {
  return (attachment as ImageAttachmentPart & { blob?: BlobReference }).blob
}

function legacyAttachmentUrl(attachment: ImageAttachmentPart) {
  const value = (attachment as ImageAttachmentPart & { dataUrl?: unknown }).dataUrl
  return typeof value === "string" && value.startsWith("data:") ? value : undefined
}

export function createPromptAttachments(input: PromptAttachmentsInput) {
  const language = useLanguage()
  const attachments = createPromptAttachmentsCore({
    ...input,
    capture: input.prompt.capture,
    warn: () => {
      showToast({
        title: language.t("prompt.toast.pasteUnsupported.title"),
        description: language.t("prompt.toast.pasteUnsupported.description"),
      })
    },
    duplicate: () => showToast({ title: language.t("prompt.toast.attachmentDuplicate.title") }),
  })

  const handleGlobalDragOver = (event: DragEvent) => {
    if (input.isDialogActive()) return

    event.preventDefault()
    const hasFiles = event.dataTransfer?.types.includes("Files")
    const hasText = event.dataTransfer?.types.includes("text/plain")
    if (hasFiles) {
      input.setDraggingType("image")
    } else if (hasText) {
      input.setDraggingType("@mention")
    }
  }

  const handleGlobalDragLeave = (event: DragEvent) => {
    if (input.isDialogActive()) return
    if (!event.relatedTarget) {
      input.setDraggingType(null)
    }
  }

  const handleGlobalDrop = async (event: DragEvent) => {
    if (input.isDialogActive()) return

    event.preventDefault()
    input.setDraggingType(null)

    const plainText = event.dataTransfer?.getData("text/plain")
    const filePrefix = "file:"
    if (plainText?.startsWith(filePrefix)) {
      const filePath = plainText.slice(filePrefix.length)
      input.focusEditor()
      input.addPart({ type: "file", path: filePath, content: "@" + filePath, start: 0, end: 0 })
      return
    }

    const dropped = event.dataTransfer?.files
    if (!dropped) return

    await attachments.addAttachments(Array.from(dropped))
  }

  onMount(() => {
    makeEventListener(document, "dragover", handleGlobalDragOver)
    makeEventListener(document, "dragleave", handleGlobalDragLeave)
    makeEventListener(document, "drop", handleGlobalDrop)
  })

  return attachments
}
