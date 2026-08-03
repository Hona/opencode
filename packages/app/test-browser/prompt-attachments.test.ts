import { describe, expect, test } from "bun:test"
import { createEffect, createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createPromptAttachmentsCore } from "@/components/prompt-input/attachments"
import { createPromptState, type Prompt } from "@/context/prompt"
import { createPromptInputV2Attachments } from "../../session-ui/src/v2/components/prompt-input/attachments"
import type { PromptInputV2Prompt } from "../../session-ui/src/v2/components/prompt-input/types"

const stored = new Map<string, Uint8Array>()
const persistence = {
  async putBlob(bytes: Uint8Array) {
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")
    stored.set(digest, bytes.slice())
    return { digest, byteLength: bytes.byteLength }
  },
  async readBlob(reference: { digest: string }) {
    return stored.get(reference.digest)?.slice() ?? null
  },
}

describe("prompt attachment session ownership", () => {
  test("stores attachment bytes before adding the reference to prompt state", async () => {
    await createRoot(async (dispose) => {
      const prompt = createPromptState()
      const called = Promise.withResolvers<void>()
      const stored = Promise.withResolvers<{ digest: string; byteLength: number }>()
      const attachments = createPromptAttachmentsCore({
        capture: prompt.capture,
        editor: () => document.createElement("div"),
        putBlob: async () => {
          called.resolve()
          return stored.promise
        },
        readBlob: async () => null,
      })
      const pending = attachments.addAttachment(new File(["content"], "a.txt", { type: "text/plain" }))

      await called.promise
      expect(images(prompt)).toHaveLength(0)
      stored.resolve({ digest: "stored", byteLength: 7 })
      await pending

      expect(images(prompt)).toEqual([expect.objectContaining({ blob: { digest: "stored", byteLength: 7 } })])
      dispose()
    })
  })

  test("loads hydrated attachment bytes only when a preview is requested", async () => {
    await createRoot(async (dispose) => {
      const prompt = createPromptState()
      prompt.set([
        {
          type: "image",
          id: "hydrated",
          filename: "hydrated.png",
          mime: "image/png",
          blob: { digest: "hydrated", byteLength: 3 },
        },
      ])
      let reads = 0
      const attachments = createPromptAttachmentsCore({
        capture: prompt.capture,
        editor: () => document.createElement("div"),
        putBlob: persistence.putBlob,
        readBlob: async () => {
          reads++
          return new Uint8Array([1, 2, 3])
        },
      })
      const attachment = images(prompt)[0]!

      expect(reads).toBe(0)
      expect(attachments.previewUrl(attachment)).toBeUndefined()
      await Bun.sleep(0)
      expect(reads).toBe(1)
      expect(attachments.previewUrl(attachment)).toStartWith("blob:")
      dispose()
    })
  })

  test("migrates a persisted data URL to a blob reference", async () => {
    await createRoot(async (dispose) => {
      const prompt = createPromptState()
      prompt.set([
        {
          type: "image",
          id: "legacy",
          filename: "legacy.txt",
          mime: "text/plain",
          dataUrl: "data:text/plain;base64,aGVsbG8=",
        },
      ] as unknown as Prompt)
      createPromptAttachmentsCore({
        capture: prompt.capture,
        editor: () => document.createElement("div"),
        ...persistence,
      })

      await Bun.sleep(10)

      expect(images(prompt)[0]).toMatchObject({ blob: { byteLength: 5 } })
      expect(images(prompt)[0]).not.toHaveProperty("dataUrl")
      dispose()
    })
  })

  test("adds an asynchronously read image to the session where the read started", async () => {
    await createRoot(async (dispose) => {
      const sessions = { A: createPromptState(), B: createPromptState() }
      let active: "A" | "B" = "A"
      const attachments = createPromptAttachmentsCore({
        capture: () => sessions[active].capture(),
        editor: () => document.createElement("div"),
        ...persistence,
      })
      const pending = attachments.addAttachment(new File([new Uint8Array(1024 * 1024)], "a.png", { type: "image/png" }))

      active = "B"
      await pending

      expect(images(sessions.A)).toHaveLength(1)
      expect(images(sessions.A)[0]).toMatchObject({ blob: { byteLength: 1024 * 1024 } })
      expect(images(sessions.A)[0]).not.toHaveProperty("dataUrl")
      expect(images(sessions.B)).toHaveLength(0)
      dispose()
    })
  })

  test("finishes the captured attachment after the active editor is removed", async () => {
    await createRoot(async (dispose) => {
      const prompt = createPromptState()
      let editor: HTMLDivElement | undefined = document.createElement("div")
      const attachments = createPromptAttachmentsCore({
        capture: prompt.capture,
        editor: () => editor,
        ...persistence,
      })
      const pending = attachments.addAttachment(new File([new Uint8Array(1024 * 1024)], "a.png", { type: "image/png" }))

      editor = undefined
      await pending

      expect(images(prompt)).toHaveLength(1)
      dispose()
    })
  })

  test("keeps every file in a batch on the session where the batch started", async () => {
    await createRoot(async (dispose) => {
      const sessions = { A: createPromptState(), B: createPromptState() }
      let active: "A" | "B" = "A"
      const attachments = createPromptAttachmentsCore({
        capture: () => sessions[active].capture(),
        editor: () => document.createElement("div"),
        ...persistence,
      })
      const pending = attachments.addAttachments([
        new File([new Uint8Array(1024 * 1024).fill(1)], "first.png", { type: "image/png" }),
        new File([new Uint8Array(1024 * 1024).fill(2)], "second.png", { type: "image/png" }),
      ])

      active = "B"
      await pending

      expect(images(sessions.A)).toHaveLength(2)
      expect(images(sessions.B)).toHaveLength(0)
      dispose()
    })
  })

  test("keeps a delayed native clipboard image on the session where paste started", async () => {
    await createRoot(async (dispose) => {
      const sessions = { A: createPromptState(), B: createPromptState() }
      const read = Promise.withResolvers<File | null>()
      let active: "A" | "B" = "A"
      const attachments = createPromptAttachmentsCore({
        capture: () => sessions[active].capture(),
        editor: () => document.createElement("div"),
        ...persistence,
      })
      const pending = attachments.addClipboardAttachment(read.promise)

      active = "B"
      read.resolve(new File([new Uint8Array(1024 * 1024)], "clipboard.png", { type: "image/png" }))
      await pending

      expect(images(sessions.A)).toHaveLength(1)
      expect(images(sessions.B)).toHaveLength(0)
      dispose()
    })
  })
})

test("rejects a duplicate native clipboard attachment in the V2 prompt store", async () => {
  await createRoot(async (dispose) => {
    const [state, setState] = createStore({ prompt: [] as PromptInputV2Prompt })
    const duplicate = Promise.withResolvers<void>()
    const files = [
      new File(["hello"], "clipboard-1.txt", { type: "text/plain" }),
      new File(["hello"], "clipboard-2.txt", { type: "text/plain" }),
    ]
    const attachments = createPromptInputV2Attachments({
      capture: () => ({
        current: () => state.prompt,
        cursor: () => 0,
        set: (prompt) => setState("prompt", prompt),
      }),
      editor: () => document.createElement("div"),
      focusEditor: () => undefined,
      addPart: () => false,
      setDraggingType: () => undefined,
      directory: () => "/",
      isDialogActive: () => false,
      warn: () => undefined,
      duplicate: duplicate.resolve,
      onError: () => undefined,
      readClipboardImage: async () => files.shift() ?? null,
      ...persistence,
    })
    const event = {
      clipboardData: { items: [], getData: () => "" },
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
    } as unknown as ClipboardEvent

    await attachments.handlePaste(event)
    await attachments.handlePaste(event)
    await duplicate.promise

    expect(state.prompt).toHaveLength(1)
    dispose()
  })
})

test("keeps a new V2 image preview stable when its pending blob read resolves", async () => {
  await createRoot(async (dispose) => {
    const [state, setState] = createStore({ prompt: [] as PromptInputV2Prompt })
    const read = Promise.withResolvers<Uint8Array | null>()
    let attachments: ReturnType<typeof createPromptInputV2Attachments> | undefined
    createEffect(() => {
      const attachment = state.prompt.find((part) => part.type === "image")
      if (attachment) attachments?.previewUrl(attachment)
    })
    attachments = createPromptInputV2Attachments({
      capture: () => ({
        current: () => state.prompt,
        cursor: () => 0,
        set: (prompt) => setState("prompt", prompt),
      }),
      editor: () => document.createElement("div"),
      focusEditor: () => undefined,
      addPart: () => false,
      setDraggingType: () => undefined,
      directory: () => "/",
      isDialogActive: () => false,
      warn: () => undefined,
      duplicate: () => undefined,
      onError: () => undefined,
      putBlob: async (bytes) => ({ digest: "new-image", byteLength: bytes.byteLength }),
      readBlob: () => read.promise,
    })

    await attachments.addAttachments([new File([new Uint8Array([1, 2, 3])], "new.png", { type: "image/png" })])
    const attachment = state.prompt.find((part) => part.type === "image")
    if (!attachment) throw new Error("Attachment was not added")
    const preview = attachments.previewUrl(attachment)
    expect(preview).toStartWith("blob:")

    read.resolve(new Uint8Array([1, 2, 3]))
    await Bun.sleep(0)

    expect(attachments.previewUrl(attachment)).toBe(preview)
    dispose()
  })
})

test("uses source identity when detecting V2 attachment duplicates", async () => {
  await createRoot(async (dispose) => {
    const [state, setState] = createStore({ prompt: [] as PromptInputV2Prompt })
    const duplicates: string[] = []
    const attachments = createPromptInputV2Attachments({
      capture: () => ({
        current: () => state.prompt,
        cursor: () => 0,
        set: (prompt) => setState("prompt", prompt),
      }),
      editor: () => document.createElement("div"),
      focusEditor: () => undefined,
      addPart: () => false,
      setDraggingType: () => undefined,
      directory: () => "/",
      isDialogActive: () => false,
      warn: () => undefined,
      duplicate: () => duplicates.push("duplicate"),
      onError: () => undefined,
      getPathForFile: (file) => (file.name === "browser.txt" ? "" : `/tmp/${file.name}`),
      ...persistence,
    })
    const first = new File(["first"], "a.txt", { type: "text/plain" })
    const second = new File(["second"], "b.txt", { type: "text/plain" })

    await attachments.addAttachments([first, second])
    await attachments.addAttachments([first, second])
    expect(state.prompt).toHaveLength(2)
    expect(duplicates).toEqual(["duplicate", "duplicate"])

    await attachments.addAttachments([
      new File(["same"], "c.txt", { type: "text/plain" }),
      new File(["same"], "d.txt", { type: "text/plain" }),
    ])
    expect(state.prompt).toHaveLength(4)
    expect(duplicates).toHaveLength(2)

    await attachments.addAttachments([new File(["edited"], "a.txt", { type: "text/plain" })])
    expect(state.prompt).toHaveLength(5)

    await attachments.addAttachments([
      new File(["same"], "browser.txt", { type: "text/plain" }),
      new File(["same"], "browser.txt", { type: "text/plain" }),
    ])
    expect(state.prompt).toHaveLength(6)
    expect(duplicates).toHaveLength(3)
    dispose()
  })
})

function images(prompt: ReturnType<typeof createPromptState>) {
  return prompt.current().filter((part) => part.type === "image")
}
