import { batch, createMemo, createRoot, onCleanup } from "solid-js"
import { createStore, reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { persisted } from "@/utils/persist"
import { ScopedKey } from "@/utils/server-scope"
import { createScopedCache } from "@/utils/scoped-cache"
import { uuid } from "@/utils/uuid"
import type { SelectedLineRange } from "@/context/file"
import { DirectoryState, type DirectoryStateScope, useDirectory } from "./directory"

export type LineComment = {
  id: string
  file: string
  selection: SelectedLineRange
  comment: string
  time: number
}

type CommentFocus = { file: string; id: string }

const MAX_COMMENT_SESSIONS = 20

type Scope = DirectoryStateScope

type CommentStore = {
  comments: Record<string, LineComment[]>
}

function aggregate(comments: Record<string, LineComment[]>) {
  return Object.keys(comments)
    .flatMap((file) => comments[file] ?? [])
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
    selection: cloneSelection(comment.selection),
  }
}

function group(comments: LineComment[]) {
  return comments.reduce<Record<string, LineComment[]>>((acc, comment) => {
    const list = acc[comment.file]
    const next = cloneComment(comment)
    if (list) {
      list.push(next)
      return acc
    }
    acc[comment.file] = [next]
    return acc
  }, {})
}

function createCommentSessionState(store: Store<CommentStore>, setStore: SetStoreFunction<CommentStore>) {
  const [state, setState] = createStore({
    focus: null as CommentFocus | null,
    active: null as CommentFocus | null,
  })

  const all = () => aggregate(store.comments)

  const setRef = (
    key: "focus" | "active",
    value: CommentFocus | null | ((value: CommentFocus | null) => CommentFocus | null),
  ) => setState(key, value)

  const setFocus = (value: CommentFocus | null | ((value: CommentFocus | null) => CommentFocus | null)) =>
    setRef("focus", value)

  const setActive = (value: CommentFocus | null | ((value: CommentFocus | null) => CommentFocus | null)) =>
    setRef("active", value)

  const list = (file: string) => store.comments[file] ?? []

  const add = (input: Omit<LineComment, "id" | "time">) => {
    const next: LineComment = {
      id: uuid(),
      time: Date.now(),
      ...input,
      selection: cloneSelection(input.selection),
    }

    batch(() => {
      setStore("comments", input.file, (items) => [...(items ?? []), next])
      setFocus({ file: input.file, id: next.id })
    })

    return next
  }

  const remove = (file: string, id: string) => {
    batch(() => {
      setStore("comments", file, (items) => (items ?? []).filter((item) => item.id !== id))
      setFocus((current) => (current?.file === file && current.id === id ? null : current))
    })
  }

  const update = (file: string, id: string, comment: string) => {
    setStore("comments", file, (items) =>
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
  const [store, setStore] = createStore<CommentStore>({ comments })
  return createCommentSessionState(store, setStore)
}

function createCommentSession(scope: Scope) {
  const id = DirectoryState.sessionID(scope.state)
  const dir = base64Encode(scope.directory)
  const legacy = `${dir}/comments${id ? "/" + id : ""}.v1`

  const [store, setStore, _, ready] = persisted(
    DirectoryState.persist({ ...scope, directory: dir }, "comments", [legacy]),
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
    const directory = useDirectory()
    const cache = createScopedCache(
      (_key: ScopedKey, scope: Scope) => {
        return createRoot((dispose) => ({
          value: createCommentSession(scope),
          dispose,
        }))
      },
      {
        maxEntries: MAX_COMMENT_SESSIONS,
        dispose: (entry) => entry.dispose(),
      },
    )

    onCleanup(() => cache.clear())

    const load = (scope: Scope) => cache.get(DirectoryState.key(scope), scope).value

    const session = createMemo(() => {
      const current = directory()
      return load({ serverScope: current.server.scope, directory: current.directory, state: current.state })
    })

    return {
      ready: () => session().ready(),
      list: (file: string) => session().list(file),
      all: () => session().all(),
      add: (input: Omit<LineComment, "id" | "time">) => session().add(input),
      remove: (file: string, id: string) => session().remove(file, id),
      update: (file: string, id: string, comment: string) => session().update(file, id, comment),
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
