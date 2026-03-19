import { createEffect, createRoot } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { createScopedCache } from "@/utils/scoped-cache"
import { createPathHelpers, filePathKey, type FilePath, type FilePathKey, type WorkspacePath } from "./path"
import type { FileViewState, SelectedLineRange } from "./types"

const WORKSPACE_KEY = "__workspace__"
const MAX_FILE_VIEW_SESSIONS = 20
const MAX_VIEW_FILES = 500
const fileKey = (path: FilePath) => filePathKey(path)

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

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

function state(value: unknown): FileViewState | undefined {
  if (!record(value)) return
  return {
    ...(num(value.scrollTop) !== undefined ? { scrollTop: num(value.scrollTop) } : {}),
    ...(num(value.scrollLeft) !== undefined ? { scrollLeft: num(value.scrollLeft) } : {}),
    ...(value.selectedLines === null ? { selectedLines: null } : record(value.selectedLines) ? { selectedLines: value.selectedLines as SelectedLineRange } : {}),
  }
}

function merge(prev: FileViewState, next: FileViewState) {
  return {
    ...prev,
    ...next,
    ...(next.selectedLines !== undefined ? { selectedLines: next.selectedLines } : {}),
  }
}

export function migrateFileViewState(dir: WorkspacePath, value: unknown) {
  if (!record(value)) return value
  if (!record(value.file)) return value

  const path = createPathHelpers(() => dir)
  let changed = false
  const file: Record<FilePathKey, FileViewState> = {}

  for (const [name, item] of Object.entries(value.file)) {
    const next = state(item)
    if (!next) {
      changed = true
      continue
    }

    const normalized = path.normalize(name)
    const key = fileKey(normalized)
    if (key !== name || file[key]) changed = true
    file[key] = file[key] ? merge(file[key], next) : next
  }

  if (!changed) return value
  return {
    ...value,
    file,
  }
}

function createViewSession(dir: WorkspacePath, id: string | undefined) {
  const [view, setView, _, ready] = persisted(
    {
      ...Persist.scoped(dir, id, "file-view", Persist.legacyScoped(dir, id, "file", "v1")),
      migrate: (value) => migrateFileViewState(dir, value),
    },
    createStore<{
      file: Record<FilePathKey, FileViewState>
    }>({
      file: {},
    }),
  )

  const meta = { pruned: false }

  const pruneView = (keep?: FilePathKey) => {
    const keys = Object.keys(view.file)
    if (keys.length <= MAX_VIEW_FILES) return

    const drop = keys.filter((key) => key !== keep).slice(0, keys.length - MAX_VIEW_FILES)
    if (drop.length === 0) return

    setView(
      produce((draft) => {
        for (const key of drop as FilePathKey[]) {
          delete draft.file[key]
        }
      }),
    )
  }

  createEffect(() => {
    if (!ready()) return
    if (meta.pruned) return
    meta.pruned = true
    pruneView()
  })

  const scrollTop = (path: FilePath) => view.file[fileKey(path)]?.scrollTop
  const scrollLeft = (path: FilePath) => view.file[fileKey(path)]?.scrollLeft
  const selectedLines = (path: FilePath) => view.file[fileKey(path)]?.selectedLines

  const setScrollTop = (path: FilePath, top: number) => {
    const key = fileKey(path)
    setView(
      produce((draft) => {
        const file = draft.file[key] ?? (draft.file[key] = {})
        if (file.scrollTop === top) return
        file.scrollTop = top
      }),
    )
    pruneView(key)
  }

  const setScrollLeft = (path: FilePath, left: number) => {
    const key = fileKey(path)
    setView(
      produce((draft) => {
        const file = draft.file[key] ?? (draft.file[key] = {})
        if (file.scrollLeft === left) return
        file.scrollLeft = left
      }),
    )
    pruneView(key)
  }

  const setSelectedLines = (path: FilePath, range: SelectedLineRange | null) => {
    const key = fileKey(path)
    const next = range ? normalizeSelectedLines(range) : null
    setView(
      produce((draft) => {
        const file = draft.file[key] ?? (draft.file[key] = {})
        if (equalSelectedLines(file.selectedLines, next)) return
        file.selectedLines = next
      }),
    )
    pruneView(key)
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
    (key) => {
      const split = key.lastIndexOf("\n")
      const dir = split >= 0 ? key.slice(0, split) : key
      const id = split >= 0 ? key.slice(split + 1) : WORKSPACE_KEY
      return createRoot((dispose) => ({
        value: createViewSession(dir, id === WORKSPACE_KEY ? undefined : id),
        dispose,
      }))
    },
    {
      maxEntries: MAX_FILE_VIEW_SESSIONS,
      dispose: (entry) => entry.dispose(),
    },
  )

  return {
    load: (dir: WorkspacePath, id: string | undefined) => {
      const key = `${dir}\n${id ?? WORKSPACE_KEY}`
      return cache.get(key).value
    },
    clear: () => cache.clear(),
  }
}
