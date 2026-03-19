import { createSimpleContext } from "@opencode-ai/ui/context"
import { checksum } from "@opencode-ai/util/encode"
import { useParams } from "@solidjs/router"
import { batch, createMemo, createRoot, getOwner, onCleanup } from "solid-js"
import { createStore, type SetStoreFunction, type Store } from "solid-js/store"
import type { FileSelection } from "@/context/file"
import { filePathEqual, filePathKey, type FilePath } from "@/context/file/path"
import { Persist, persisted } from "@/utils/persist"

interface PartBase {
  content: string
  start: number
  end: number
}

export interface TextPart extends PartBase {
  type: "text"
}

export interface FileAttachmentPart extends PartBase {
  type: "file"
  path: FilePath
  selection?: FileSelection
}

export interface AgentPart extends PartBase {
  type: "agent"
  name: string
}

export interface ImageAttachmentPart {
  type: "image"
  id: string
  filename: string
  mime: string
  dataUrl: string
}

export type ContentPart = TextPart | FileAttachmentPart | AgentPart | ImageAttachmentPart
export type Prompt = ContentPart[]

export type FileContextItem = {
  type: "file"
  path: FilePath
  selection?: FileSelection
  comment?: string
  commentID?: string
  commentOrigin?: "review" | "file"
  preview?: string
}

export type ContextItem = FileContextItem

export const DEFAULT_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

function isSelectionEqual(a?: FileSelection, b?: FileSelection) {
  if (!a && !b) return true
  if (!a || !b) return false
  return (
    a.startLine === b.startLine && a.startChar === b.startChar && a.endLine === b.endLine && a.endChar === b.endChar
  )
}

function isPartEqual(partA: ContentPart, partB: ContentPart) {
  switch (partA.type) {
    case "text":
      return partB.type === "text" && partA.content === partB.content
    case "file":
      return partB.type === "file" && filePathEqual(partA.path, partB.path) && isSelectionEqual(partA.selection, partB.selection)
    case "agent":
      return partB.type === "agent" && partA.name === partB.name
    case "image":
      return partB.type === "image" && partA.id === partB.id
  }
}

export function isPromptEqual(promptA: Prompt, promptB: Prompt): boolean {
  if (promptA.length !== promptB.length) return false
  for (let i = 0; i < promptA.length; i++) {
    if (!isPartEqual(promptA[i], promptB[i])) return false
  }
  return true
}

function cloneSelection(selection?: FileSelection) {
  if (!selection) return undefined
  return { ...selection }
}

function clonePart(part: ContentPart): ContentPart {
  if (part.type === "text") return { ...part }
  if (part.type === "image") return { ...part }
  if (part.type === "agent") return { ...part }
  return {
    ...part,
    selection: cloneSelection(part.selection),
  }
}

function clonePrompt(prompt: Prompt): Prompt {
  return prompt.map(clonePart)
}

function contextItemKey(item: ContextItem) {
  if (item.type !== "file") return item.type
  const start = item.selection?.startLine
  const end = item.selection?.endLine
  const key = `${item.type}:${filePathKey(item.path)}:${start}:${end}`

  if (item.commentID) {
    return `${key}:c=${item.commentID}`
  }

  const comment = item.comment?.trim()
  if (!comment) return key
  const digest = checksum(comment) ?? comment
  return `${key}:c=${digest.slice(0, 8)}`
}

function normalizeContextItem(item: ContextItem | (ContextItem & { key?: string })) {
  if (item.type !== "file") return { ...item, key: contextItemKey(item) }
  const path = filePathKey(item.path) as FilePath
  const next = { ...item, path }
  return { ...next, key: contextItemKey(next) }
}

function isContextItem(value: unknown): value is ContextItem | (ContextItem & { key?: string }) {
  return (
    !!value &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "file" &&
    "path" in value &&
    typeof value.path === "string"
  )
}

function migratePromptStore(value: unknown) {
  if (!value || typeof value !== "object") return value
  if (!("context" in value)) return value
  const context = (value as { context?: { items?: unknown } }).context
  if (!context || !Array.isArray(context.items)) return value
  return {
      ...value,
      context: {
        ...context,
        items: context.items.filter(isContextItem).map(normalizeContextItem),
      },
  }
}

function isCommentItem(item: ContextItem | (ContextItem & { key: string })) {
  return item.type === "file" && !!item.comment?.trim()
}

type PromptStore = {
  prompt: Prompt
  cursor?: number
  context: {
    items: (ContextItem & { key: string })[]
  }
}

function createPromptActions(
  setStore: SetStoreFunction<PromptStore>,
) {
  return {
    set(prompt: Prompt, cursorPosition?: number) {
      const next = clonePrompt(prompt)
      batch(() => {
        setStore("prompt", next)
        if (cursorPosition !== undefined) setStore("cursor", cursorPosition)
      })
    },
    reset() {
      batch(() => {
        setStore("prompt", clonePrompt(DEFAULT_PROMPT))
        setStore("cursor", 0)
      })
    },
  }
}

const WORKSPACE_KEY = "__workspace__"
const MAX_PROMPT_SESSIONS = 20

type PromptSession = ReturnType<typeof createPromptSession>

type Scope = {
  dir: string
  id?: string
}

type PromptCacheEntry = {
  value: PromptSession
  dispose: VoidFunction
}

function createPromptSessionState(store: Store<PromptStore>, setStore: SetStoreFunction<PromptStore>) {
  const actions = createPromptActions(setStore)

  return {
    current: createMemo(() => store.prompt),
    cursor: createMemo(() => store.cursor),
    dirty: createMemo(() => !isPromptEqual(store.prompt, DEFAULT_PROMPT)),
    context: {
      items: createMemo(() => store.context.items),
      add(item: ContextItem) {
        const next = normalizeContextItem(item)
        const key = next.key
        if (store.context.items.find((x) => x.key === key)) return
        setStore("context", "items", (items) => [...items, next])
      },
      remove(key: string) {
        setStore("context", "items", (items) => items.filter((x) => x.key !== key))
      },
      removeComment(path: FilePath, commentID: string) {
        const key = filePathKey(path)
        setStore("context", "items", (items) =>
          items.filter((item) => !(item.type === "file" && filePathKey(item.path) === key && item.commentID === commentID)),
        )
      },
      updateComment(path: FilePath, commentID: string, next: Partial<FileContextItem> & { comment?: string }) {
        const key = filePathKey(path)
        setStore("context", "items", (items) =>
          items.map((item) => {
            if (item.type !== "file" || filePathKey(item.path) !== key || item.commentID !== commentID) return item
            return normalizeContextItem({ ...item, ...next })
          }),
        )
      },
      replaceComments(items: FileContextItem[]) {
        setStore("context", "items", (current) => [
          ...current.filter((item) => !isCommentItem(item)),
          ...items.map(normalizeContextItem),
        ])
      },
    },
    set: actions.set,
    reset: actions.reset,
  }
}

export function createPromptSessionForTest(input?: Partial<PromptStore>) {
  const [store, setStore] = createStore<PromptStore>({
    prompt: clonePrompt(input?.prompt ?? DEFAULT_PROMPT),
    cursor: input?.cursor,
    context: {
      items: input?.context?.items?.map(normalizeContextItem) ?? [],
    },
  })

  const session = createPromptSessionState(store, setStore)

  return {
    ...session,
    current: () => store.prompt,
    cursor: () => store.cursor,
    dirty: () => !isPromptEqual(store.prompt, DEFAULT_PROMPT),
    context: {
      ...session.context,
      items: () => store.context.items,
    },
  }
}

function createPromptSession(dir: string, id: string | undefined) {
  const [store, setStore, _, ready] = persisted(
    {
      ...Persist.scoped(dir, id, "prompt", Persist.legacyScoped(dir, id, "prompt", "v2")),
      migrate: migratePromptStore,
    },
    createStore<PromptStore>({
      prompt: clonePrompt(DEFAULT_PROMPT),
      cursor: undefined,
      context: {
        items: [],
      },
    }),
  )

  const session = createPromptSessionState(store, setStore)

  return {
    ready,
    ...session,
  }
}

export const { use: usePrompt, provider: PromptProvider } = createSimpleContext({
  name: "Prompt",
  gate: false,
  init: () => {
    const params = useParams()
    const cache = new Map<string, PromptCacheEntry>()

    const disposeAll = () => {
      for (const entry of cache.values()) {
        entry.dispose()
      }
      cache.clear()
    }

    onCleanup(disposeAll)

    const prune = () => {
      while (cache.size > MAX_PROMPT_SESSIONS) {
        const first = cache.keys().next().value
        if (!first) return
        const entry = cache.get(first)
        entry?.dispose()
        cache.delete(first)
      }
    }

    const owner = getOwner()
    const load = (dir: string, id: string | undefined) => {
      const key = `${dir}:${id ?? WORKSPACE_KEY}`
      const existing = cache.get(key)
      if (existing) {
        cache.delete(key)
        cache.set(key, existing)
        return existing.value
      }

      const entry = createRoot(
        (dispose) => ({
          value: createPromptSession(dir, id),
          dispose,
        }),
        owner,
      )

      cache.set(key, entry)
      prune()
      return entry.value
    }

    const session = createMemo(() => load(params.dir!, params.id))
    const pick = (scope?: Scope) => (scope ? load(scope.dir, scope.id) : session())

    return {
      ready: () => session().ready(),
      current: () => session().current(),
      cursor: () => session().cursor(),
      dirty: () => session().dirty(),
      context: {
        items: () => session().context.items(),
        add: (item: ContextItem) => session().context.add(item),
        remove: (key: string) => session().context.remove(key),
        removeComment: (path: FilePath, commentID: string) => session().context.removeComment(path, commentID),
        updateComment: (path: FilePath, commentID: string, next: Partial<FileContextItem> & { comment?: string }) =>
          session().context.updateComment(path, commentID, next),
        replaceComments: (items: FileContextItem[]) => session().context.replaceComments(items),
      },
      set: (prompt: Prompt, cursorPosition?: number, scope?: Scope) => pick(scope).set(prompt, cursorPosition),
      reset: (scope?: Scope) => pick(scope).reset(),
    }
  },
})
