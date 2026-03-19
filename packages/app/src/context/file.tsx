import { batch, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { showToast } from "@opencode-ai/ui/toast"
import { useParams } from "@solidjs/router"
import { getFilename } from "@opencode-ai/util/path"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { sessionKey } from "@/utils/session-key"
import { createPathHelpers, filePathKey, workspacePathKey, type FilePath, type FilePathKey } from "./file/path"
import {
  approxBytes,
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
import { createFileTreeStore } from "./file/tree-store"
import { invalidateFromWatcher } from "./file/watcher"
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

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return fallback
}

export const { use: useFile, provider: FileProvider } = createSimpleContext({
  name: "File",
  gate: false,
  init: () => {
    const sdk = useSDK()
    useSync()
    const params = useParams()
    const language = useLanguage()
    const layout = useLayout()

    const scope = createMemo(() => sdk.directory)
    const path = createPathHelpers(scope)
    const tabs = layout.tabs(() => sessionKey(params.dir ?? "", params.id))
    const fileKey = (file: FilePath) => filePathKey(file)
    const loadKey = (directory: string, file: FilePath) => `${workspacePathKey(directory)}\n${fileKey(file)}`

    const inflight = new Map<string, Promise<void>>()
    const [store, setStore] = createStore<{
      file: Record<FilePathKey, FileState>
    }>({
      file: {},
    })

    const tree = createFileTreeStore({
      scope,
      normalize: path.normalize,
      normalizeDir: path.normalizeDir,
      list: (dir) => sdk.client.file.list({ path: dir }).then((x) => x.data ?? []),
      onError: (message) => {
        showToast({
          variant: "error",
          title: language.t("toast.file.listFailed.title"),
          description: message,
        })
      },
    })

    const evictContent = (keep?: Set<string>) => {
      evictContentLru(keep, (target) => {
        const key = fileKey(target as FilePath)
        if (!store.file[key]) return
        setStore(
          "file",
          key,
          produce((draft) => {
            draft.content = undefined
            draft.loaded = false
          }),
        )
      })
    }

    createEffect(() => {
      scope()
      inflight.clear()
      resetFileContentLru()
      batch(() => {
        setStore("file", reconcile({}))
        tree.reset()
      })
    })

    const viewCache = createFileViewCache()
    const view = createMemo(() => viewCache.load(scope(), params.id))

    const ensure = (file: FilePath) => {
      if (!file) return
      const key = fileKey(file)
      if (store.file[key]) return
      setStore("file", key, { path: file, name: getFilename(file) })
    }

    const setLoading = (file: FilePath) => {
      const key = fileKey(file)
      setStore(
        "file",
        key,
        produce((draft) => {
          draft.loading = true
          draft.error = undefined
        }),
      )
    }

    const setLoaded = (file: FilePath, content: FileState["content"]) => {
      const key = fileKey(file)
      setStore(
        "file",
        key,
        produce((draft) => {
          draft.loaded = true
          draft.loading = false
          draft.content = content
        }),
      )
    }

    const setLoadError = (file: FilePath, message: string) => {
      const key = fileKey(file)
      setStore(
        "file",
        key,
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

    const loadFile = (file: FilePath, options?: { force?: boolean }) => {
      const directory = scope()
      const key = loadKey(directory, file)
      ensure(file)

      const current = store.file[fileKey(file)]
      if (!options?.force && current?.loaded) return Promise.resolve()

      const pending = inflight.get(key)
      if (pending) return pending

      setLoading(file)

      const promise = sdk.client.file
        .read({ path: file })
        .then((x) => {
          if (scope() !== directory) return
          const content = x.data
          setLoaded(file, content)

          if (!content) return
          touchFileContent(file, approxBytes(content))
          evictContent(new Set([file]))
        })
        .catch((e) => {
          if (scope() !== directory) return
          setLoadError(file, errorMessage(e, language.t("error.chain.unknown")))
        })
        .finally(() => {
          inflight.delete(key)
        })

      inflight.set(key, promise)
      return promise
    }

    const load = (input: string, options?: { force?: boolean }) => loadFile(path.normalize(input), options)

    const search = (query: string, dirs: "true" | "false") =>
      sdk.client.find.files({ query, dirs }).then(
        (x) => (x.data ?? []).map(path.normalize),
        () => [],
      )

    const openFile = (key: FilePathKey) => {
      for (const tab of tabs.all()) {
        const file = path.pathFromTab(tab)
        if (!file || fileKey(file) !== key) continue
        return file
      }
    }

    const stop = sdk.event.listen((e) => {
      invalidateFromWatcher(e.details, {
        normalize: path.normalize,
        file: (key) => store.file[key]?.path,
        open: openFile,
        dir: tree.dirPathByKey,
        loadFile: (file) => {
          void loadFile(file, { force: true })
        },
        refreshDir: (dir) => {
          void tree.listDir(dir, { force: true })
        },
      })
    })

    const getFile = (file: FilePath) => {
      const state = store.file[fileKey(file)]
      const content = state?.content
      if (!content) return state
      if (hasFileContent(file)) {
        touchFileContent(file)
        return state
      }
      touchFileContent(file, approxBytes(content))
      return state
    }

    const get = (input: string) => getFile(path.normalize(input))

    function withFile<T>(input: string, action: (file: FilePath) => T) {
      return action(path.normalize(input))
    }
    const scrollTop = (input: string) => withFile(input, (file) => view().scrollTop(file))
    const scrollLeft = (input: string) => withFile(input, (file) => view().scrollLeft(file))
    const selectedLines = (input: string) => withFile(input, (file) => view().selectedLines(file))
    const setScrollTop = (input: string, top: number) => withFile(input, (file) => view().setScrollTop(file, top))
    const setScrollLeft = (input: string, left: number) => withFile(input, (file) => view().setScrollLeft(file, left))
    const setSelectedLines = (input: string, range: SelectedLineRange | null) =>
      withFile(input, (file) => view().setSelectedLines(file, range))

    onCleanup(() => {
      stop()
      viewCache.clear()
    })

    return {
      ready: () => view().ready(),
      normalize: path.normalize,
      display: path.display,
      tab: path.tab,
      normalizeTab: path.normalizeTab,
      pathFromTab: path.pathFromTab,
      tree: {
        list: tree.listDir,
        refresh: (input: string) => tree.listDir(input, { force: true }),
        state: tree.dirState,
        children: tree.children,
        expand: tree.expandDir,
        collapse: tree.collapseDir,
        toggle(input: string) {
          if (tree.dirState(input)?.expanded) {
            tree.collapseDir(input)
            return
          }
          tree.expandDir(input)
        },
      },
      get,
      load,
      scrollTop,
      scrollLeft,
      setScrollTop,
      setScrollLeft,
      selectedLines,
      setSelectedLines,
      searchFiles: (query: string) => search(query, "false"),
      searchFilesAndDirectories: (query: string) => search(query, "true"),
    }
  },
})
