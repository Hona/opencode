import { createRoot } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { persisted } from "@/utils/persist"
import { createScopedCache } from "@/utils/scoped-cache"
import type { FileViewState, SelectedLineRange } from "./types"
import { ScopedKey } from "@/utils/server-scope"
import { DirectoryState, type DirectoryStateScope } from "../directory"

const MAX_FILE_VIEW_SESSIONS = 20
const MAX_VIEW_FILES = 500

function normalizeSelectedLines(range: SelectedLineRange): SelectedLineRange {
  if (range.start <= range.end) return { ...range }

  const startSide = range.side
  const endSide = range.endSide ?? startSide

  return {
    ...range,
    start: range.end,
    end: range.start,
    side: endSide,
    endSide: startSide !== endSide ? startSide : undefined,
  }
}

function equalSelectedLines(a: SelectedLineRange | null | undefined, b: SelectedLineRange | null | undefined) {
  if (!a && !b) return true
  if (!a || !b) return false
  const left = normalizeSelectedLines(a)
  const right = normalizeSelectedLines(b)
  return (
    left.start === right.start && left.end === right.end && left.side === right.side && left.endSide === right.endSide
  )
}

function createViewSession(scope: DirectoryStateScope) {
  const id = DirectoryState.sessionID(scope.state)
  const dir = scope.directory
  const legacyViewKey = `${dir}/file${id ? "/" + id : ""}.v1`

  const [view, setView, _, ready] = persisted(
    DirectoryState.persist(scope, "file-view", [legacyViewKey]),
    createStore<{
      file: Record<string, FileViewState>
    }>({
      file: {},
    }),
  )

  const pruneView = (keep?: string) => {
    const keys = Object.keys(view.file)
    if (keys.length <= MAX_VIEW_FILES) return

    const drop = keys.filter((key) => key !== keep).slice(0, keys.length - MAX_VIEW_FILES)
    if (drop.length === 0) return

    setView(
      produce((draft) => {
        for (const key of drop) {
          delete draft.file[key]
        }
      }),
    )
  }

  void Promise.resolve(ready.promise).then(() => {
    pruneView()
  })

  const scrollTop = (path: string) => view.file[path]?.scrollTop
  const scrollLeft = (path: string) => view.file[path]?.scrollLeft
  const selectedLines = (path: string) => view.file[path]?.selectedLines

  const setScrollTop = (path: string, top: number) => {
    setView(
      produce((draft) => {
        const file = draft.file[path] ?? (draft.file[path] = {})
        if (file.scrollTop === top) return
        file.scrollTop = top
      }),
    )
    pruneView(path)
  }

  const setScrollLeft = (path: string, left: number) => {
    setView(
      produce((draft) => {
        const file = draft.file[path] ?? (draft.file[path] = {})
        if (file.scrollLeft === left) return
        file.scrollLeft = left
      }),
    )
    pruneView(path)
  }

  const setSelectedLines = (path: string, range: SelectedLineRange | null) => {
    const next = range ? normalizeSelectedLines(range) : null
    setView(
      produce((draft) => {
        const file = draft.file[path] ?? (draft.file[path] = {})
        if (equalSelectedLines(file.selectedLines, next)) return
        file.selectedLines = next
      }),
    )
    pruneView(path)
  }

  return {
    ready,
    scrollTop,
    scrollLeft,
    selectedLines,
    setScrollTop,
    setScrollLeft,
    setSelectedLines,
  }
}

export function createFileViewCache() {
  const cache = createScopedCache(
    (_key: ScopedKey, input: DirectoryStateScope) => {
      return createRoot((dispose) => ({
        value: createViewSession(input),
        dispose,
      }))
    },
    {
      maxEntries: MAX_FILE_VIEW_SESSIONS,
      dispose: (entry) => entry.dispose(),
    },
  )

  return {
    load: (scope: DirectoryStateScope) => cache.get(DirectoryState.key(scope), scope).value,
    clear: () => cache.clear(),
  }
}
