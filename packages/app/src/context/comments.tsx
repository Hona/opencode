import { batch, createMemo, createRoot, onCleanup } from "solid-js"
import { createStore, reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useParams } from "@solidjs/router"
import { Persist, persisted } from "@/utils/persist"
import { createScopedCache } from "@/utils/scoped-cache"
import { sessionScopeKey, sessionScopeParts } from "@/utils/session-key"
import { uuid } from "@/utils/uuid"
import type { SelectedLineRange } from "@/context/file"
import { filePathKey, normalizeFilePath, type FilePath, type FilePathKey } from "@/context/file/path"

export type LineComment = {
  id: string
  file: FilePath
  selection: SelectedLineRange
  comment: string
  time: number
}

type CommentFocus = { file: FilePath; id: string }

const MAX_COMMENT_SESSIONS = 20

type CommentStore = {
  comments: Record<FilePathKey, LineComment[]>
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const text = (value: unknown) => (typeof value === "string" ? value : undefined)

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

const normalizeFile = (file: FilePath) => normalizeFilePath(file)

const commentKey = (file: FilePath) => filePathKey(file)

function aggregate(comments: Record<FilePathKey, LineComment[]>) {
  return Object.values(comments)
    .flatMap((items) => items.map(cloneComment))
    .slice()
    .sort((a, b) => a.time - b.time)
}

function cloneSelection(selection: SelectedLineRange): SelectedLineRange {
  const next: SelectedLineRange = {
    start: selection.start,
    end: selection.end,
  }

  if (selection.side) next.side = selection.side
  if (selection.endSide) next.endSide = selection.endSide
  return next
}

function cloneComment(comment: LineComment): LineComment {
  return {
    ...comment,
    file: normalizeFile(comment.file),
    selection: cloneSelection(comment.selection),
  }
}

function lineComment(value: unknown): LineComment | undefined {
  if (!record(value)) return
  const id = text(value.id)
  const file = text(value.file)
  const comment = text(value.comment)
  const time = num(value.time)
  if (!id || !file || comment === undefined || time === undefined) return
  if (!record(value.selection)) return
  const start = num(value.selection.start)
  const end = num(value.selection.end)
  if (start === undefined || end === undefined) return
  const side = value.selection.side === "additions" || value.selection.side === "deletions" ? value.selection.side : undefined
  const endSide =
    value.selection.endSide === "additions" || value.selection.endSide === "deletions"
      ? value.selection.endSide
      : undefined
  return cloneComment({
    id,
    file,
    comment,
    time,
    selection: { start, end, ...(side ? { side } : {}), ...(endSide ? { endSide } : {}) },
  })
}

function normalizeCommentMap(value: unknown) {
  if (!record(value)) return {} as Record<FilePathKey, LineComment[]>

  return Object.entries(value).reduce<Record<FilePathKey, LineComment[]>>((acc, [name, items]) => {
    if (!Array.isArray(items)) return acc
    const key = commentKey(name)
    const next = items.map(lineComment).filter((item): item is LineComment => !!item)
    if (next.length === 0) return acc
    acc[key] = [...(acc[key] ?? []), ...next]
    return acc
  }, {})
}

export function migrateCommentStore(value: unknown) {
  if (!record(value)) return value
  if (!record(value.comments)) return value

  const comments = normalizeCommentMap(value.comments)
  return {
    ...value,
    comments,
  }
}

function group(comments: LineComment[]) {
  return comments.reduce<Record<FilePathKey, LineComment[]>>((acc, comment) => {
    const key = commentKey(comment.file)
    const list = acc[key]
    const next = cloneComment(comment)
    if (list) {
      list.push(next)
      return acc
    }
    acc[key] = [next]
    return acc
  }, {})
}

function createCommentSessionState(store: Store<CommentStore>, setStore: SetStoreFunction<CommentStore>) {
  const [state, setState] = createStore({
    focus: null as CommentFocus | null,
    active: null as CommentFocus | null,
  })

  const all = () => aggregate(store.comments)

  const normalizeFocus = (value: CommentFocus | null) => (value ? { ...value, file: normalizeFile(value.file) } : null)

  const setRef = (
    key: "focus" | "active",
    value: CommentFocus | null | ((value: CommentFocus | null) => CommentFocus | null),
  ) =>
    setState(key, (current) => normalizeFocus(typeof value === "function" ? value(current) : value))

  const setFocus = (value: CommentFocus | null | ((value: CommentFocus | null) => CommentFocus | null)) =>
    setRef("focus", value)

  const setActive = (value: CommentFocus | null | ((value: CommentFocus | null) => CommentFocus | null)) =>
    setRef("active", value)

  const list = (file: FilePath) => {
    return store.comments[commentKey(file)]?.map(cloneComment) ?? []
  }

  const add = (input: Omit<LineComment, "id" | "time">) => {
    const key = commentKey(input.file)
    const file = store.comments[key]?.[0]?.file ?? normalizeFile(input.file)
    const next: LineComment = {
      id: uuid(),
      time: Date.now(),
      ...input,
      file,
      selection: cloneSelection(input.selection),
    }

    batch(() => {
      setStore("comments", key, (items) => [...(items ?? []), next])
      setFocus({ file, id: next.id })
    })

    return next
  }

  const remove = (file: FilePath, id: string) => {
    const key = commentKey(file)

    batch(() => {
      setStore("comments", key, (items) => (items ?? []).filter((item) => item.id !== id))
      setFocus((current) =>
        current && commentKey(current.file) === key && current.id === id ? null : current,
      )
    })
  }

  const update = (file: FilePath, id: string, comment: string) => {
    const key = commentKey(file)

    setStore("comments", key, (items) =>
      (items ?? []).map((item) => {
        if (item.id !== id) return item
        return { ...item, comment }
      }),
    )
  }

  const replace = (comments: LineComment[]) => {
    batch(() => {
      setStore("comments", reconcile(group(comments)))
      setFocus(null)
      setActive(null)
    })
  }

  const clear = () => {
    batch(() => {
      setStore("comments", reconcile({}))
      setFocus(null)
      setActive(null)
    })
  }

  return {
    list,
    all,
    add,
    remove,
    update,
    replace,
    clear,
    focus: () => state.focus,
    setFocus,
    clearFocus: () => setRef("focus", null),
    active: () => state.active,
    setActive,
    clearActive: () => setRef("active", null),
  }
}

export function createCommentSessionForTest(comments: Record<string, LineComment[]> = {}) {
  const [store, setStore] = createStore<CommentStore>({ comments: normalizeCommentMap(comments) })
  return createCommentSessionState(store, setStore)
}

function createCommentSession(dir: string, id: string | undefined) {
  const [store, setStore, _, ready] = persisted(
    {
      ...Persist.scoped(dir, id, "comments", Persist.legacyScoped(dir, id, "comments", "v1")),
      migrate: migrateCommentStore,
    },
    createStore<CommentStore>({
      comments: {},
    }),
  )
  const session = createCommentSessionState(store, setStore)

  return {
    ready,
    list: session.list,
    all: session.all,
    add: session.add,
    remove: session.remove,
    update: session.update,
    replace: session.replace,
    clear: session.clear,
    focus: session.focus,
    setFocus: session.setFocus,
    clearFocus: session.clearFocus,
    active: session.active,
    setActive: session.setActive,
    clearActive: session.clearActive,
  }
}

export const { use: useComments, provider: CommentsProvider } = createSimpleContext({
  name: "Comments",
  gate: false,
  init: () => {
    const params = useParams()
    const cache = createScopedCache(
      (key) => {
        const decoded = sessionScopeParts(key)
        return createRoot((dispose) => ({
          value: createCommentSession(decoded.dir, decoded.id),
          dispose,
        }))
      },
      {
        maxEntries: MAX_COMMENT_SESSIONS,
        dispose: (entry) => entry.dispose(),
      },
    )

    onCleanup(() => cache.clear())

    const load = (dir: string, id: string | undefined) => {
      const key = sessionScopeKey(dir, id)
      return cache.get(key).value
    }

    const session = createMemo(() => load(params.dir!, params.id))

    return {
      ready: () => session().ready(),
      list: (file: FilePath) => session().list(file),
      all: () => session().all(),
      add: (input: Omit<LineComment, "id" | "time">) => session().add(input),
      remove: (file: FilePath, id: string) => session().remove(file, id),
      update: (file: FilePath, id: string, comment: string) => session().update(file, id, comment),
      replace: (comments: LineComment[]) => session().replace(comments),
      clear: () => session().clear(),
      focus: () => session().focus(),
      setFocus: (focus: CommentFocus | null) => session().setFocus(focus),
      clearFocus: () => session().clearFocus(),
      active: () => session().active(),
      setActive: (active: CommentFocus | null) => session().setActive(active),
      clearActive: () => session().clearActive(),
    }
  },
})
