import { createMemo, createRoot, getOwner, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { showToast } from "@/utils/toast"
import { getFilename } from "@opencode-ai/core/util/path"
import { useDirectory } from "./directory"
import { useLanguage } from "@/context/language"
import { createPathHelpers } from "./file/path"
import {
  approxBytes,
  createFileContentCache,
  evictContentLru,
  getFileContentBytesTotal,
  getFileContentEntryCount,
  hasFileContent,
  removeFileContentBytes,
  resetFileContentLru,
  setFileContentBytes,
  touchFileContent,
} from "./file/content-cache"
import { createFileViewCache } from "./file/view-cache"
import { ScopedKey } from "@/utils/server-scope"
import { createFileTreeStore } from "./file/tree-store"
import { invalidateFromWatcher } from "./file/watcher"
import { createScopedCache } from "@/utils/scoped-cache"
import {
  selectionFromLines,
  type FileState,
  type FileSelection,
  type FileViewState,
  type SelectedLineRange,
} from "./file/types"

export type { FileSelection, SelectedLineRange, FileViewState, FileState }
export { selectionFromLines }
export {
  evictContentLru,
  getFileContentBytesTotal,
  getFileContentEntryCount,
  removeFileContentBytes,
  resetFileContentLru,
  setFileContentBytes,
  touchFileContent,
}

const MAX_FILE_DIRECTORIES = 20

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return fallback
}

export const { use: useFile, provider: FileProvider } = createSimpleContext({
  name: "File",
  gate: false,
  init: () => {
    const directory = useDirectory()
    const language = useLanguage()
    const owner = getOwner()
    const viewCache = createFileViewCache()

    const cache = createScopedCache(
      (_key: ScopedKey, current: ReturnType<typeof directory>) =>
        createRoot((dispose) => {
          const currentSDK = current.sdk
          const path = createPathHelpers(() => current.directory)
          const inflight = new Map<string, Promise<void>>()
          const contentCache = createFileContentCache()
          const [store, setStore] = createStore<{ file: Record<string, FileState> }>({ file: {} })
          const tree = createFileTreeStore({
            scope: () => current.directory,
            normalizeDir: path.normalizeDir,
            list: (dir) => currentSDK.client.file.list({ path: dir }).then((x) => x.data ?? []),
            onError: (message) => {
              showToast({
                variant: "error",
                title: language.t("toast.file.listFailed.title"),
                description: message,
              })
            },
          })

          const evictContent = (keep?: Set<string>) => {
            contentCache.evict(keep, (target) => {
              if (!store.file[target]) return
              setStore(
                "file",
                target,
                produce((draft) => {
                  draft.content = undefined
                  draft.loaded = false
                }),
              )
            })
          }

          const ensure = (file: string) => {
            if (!file) return
            if (store.file[file]) return
            setStore("file", file, { path: file, name: getFilename(file) })
          }

          const setLoading = (file: string) => {
            setStore(
              "file",
              file,
              produce((draft) => {
                draft.loading = true
                draft.error = undefined
              }),
            )
          }

          const setLoaded = (file: string, content: FileState["content"]) => {
            setStore(
              "file",
              file,
              produce((draft) => {
                draft.loaded = true
                draft.loading = false
                draft.content = content
              }),
            )
          }

          const setLoadError = (file: string, message: string) => {
            setStore(
              "file",
              file,
              produce((draft) => {
                draft.loading = false
                draft.error = message
              }),
            )
            showToast({
              variant: "error",
              title: language.t("toast.file.loadFailed.title"),
              description: message,
            })
          }

          const load = (input: string, options?: { force?: boolean }) => {
            const file = path.normalize(input)
            if (!file) return Promise.resolve()
            ensure(file)

            if (!options?.force && store.file[file]?.loaded) return Promise.resolve()
            const pending = inflight.get(file)
            if (pending) return pending
            setLoading(file)

            const promise = currentSDK.client.file
              .read({ path: file })
              .then((x) => {
                const content = x.data
                setLoaded(file, content)
                if (!content) return
                contentCache.touch(file, approxBytes(content))
                evictContent(new Set([file]))
              })
              .catch((e) => setLoadError(file, errorMessage(e, language.t("error.chain.unknown"))))
              .finally(() => inflight.delete(file))

            inflight.set(file, promise)
            return promise
          }

          const search = (query: string, dirs: "true" | "false") =>
            currentSDK.client.find.files({ query, dirs }).then(
              (x) => (x.data ?? []).map(path.normalize),
              () => [],
            )

          const get = (input: string) => {
            const file = path.normalize(input)
            const state = store.file[file]
            const content = state?.content
            if (!content) return state
            if (contentCache.has(file)) {
              contentCache.touch(file)
              return state
            }
            contentCache.touch(file, approxBytes(content))
            return state
          }

          const stop = currentSDK.event.listen((event) => {
            invalidateFromWatcher(event.details, {
              normalize: path.normalize,
              hasFile: (file) => Boolean(store.file[file]),
              loadFile: (file) => void load(file, { force: true }),
              node: tree.node,
              isDirLoaded: tree.isLoaded,
              refreshDir: (dir) => void tree.listDir(dir, { force: true }),
            })
          })

          onCleanup(() => {
            stop()
            inflight.clear()
            contentCache.reset()
            tree.reset()
          })

          return {
            value: { path, tree, get, load, search },
            dispose,
          }
        }, owner),
      {
        maxEntries: MAX_FILE_DIRECTORIES,
        dispose: (entry) => entry.dispose(),
      },
    )
    onCleanup(() => cache.clear())
    onCleanup(() => viewCache.clear())

    const selected = createMemo(() => {
      const current = directory()
      const state = cache.get(ScopedKey.from(current.server.scope, current.server.instance, current.directory), current).value
      const view = viewCache.load({ serverScope: current.server.scope, directory: current.directory, state: current.state })
      return { state, view }
    })

    return {
      ready: () => selected().view.ready(),
      normalize: (input: string) => selected().state.path.normalize(input),
      tab: (input: string) => selected().state.path.tab(input),
      pathFromTab: (input: string) => selected().state.path.pathFromTab(input),
      tree: {
        list: (input: string) => selected().state.tree.listDir(input),
        refresh: (input: string) => selected().state.tree.listDir(input, { force: true }),
        state: (input: string) => selected().state.tree.dirState(input),
        children: (input: string) => selected().state.tree.children(input),
        expand: (input: string) => selected().state.tree.expandDir(input),
        collapse: (input: string) => selected().state.tree.collapseDir(input),
        toggle(input: string) {
          const tree = selected().state.tree
          if (tree.dirState(input)?.expanded) {
            tree.collapseDir(input)
            return
          }
          tree.expandDir(input)
        },
      },
      get: (input: string) => selected().state.get(input),
      load: (input: string, options?: { force?: boolean }) => selected().state.load(input, options),
      scrollTop: (input: string) => {
        const current = selected()
        return current.view.scrollTop(current.state.path.normalize(input))
      },
      scrollLeft: (input: string) => {
        const current = selected()
        return current.view.scrollLeft(current.state.path.normalize(input))
      },
      setScrollTop: (input: string, top: number) => {
        const current = selected()
        return current.view.setScrollTop(current.state.path.normalize(input), top)
      },
      setScrollLeft: (input: string, left: number) => {
        const current = selected()
        return current.view.setScrollLeft(current.state.path.normalize(input), left)
      },
      selectedLines: (input: string) => {
        const current = selected()
        return current.view.selectedLines(current.state.path.normalize(input))
      },
      setSelectedLines: (input: string, range: SelectedLineRange | null) => {
        const current = selected()
        return current.view.setSelectedLines(current.state.path.normalize(input), range)
      },
      searchFiles: (query: string) => selected().state.search(query, "false"),
      searchFilesAndDirectories: (query: string) => selected().state.search(query, "true"),
    }
  },
})
