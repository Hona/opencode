import { createStore, produce, reconcile } from "solid-js/store"
import type { FileNode } from "@opencode-ai/sdk/v2"
import {
  ROOT_FILE_PATH,
  ROOT_FILE_PATH_KEY,
  filePathDescendsFrom,
  filePathKey,
  type FilePath,
  type FilePathKey,
  type WorkspacePath,
} from "./path"

type TreeNode = FileNode & { path: FilePath }

type DirectoryState = {
  path: FilePath
  expanded: boolean
  loaded?: boolean
  loading?: boolean
  error?: string
  children?: FilePathKey[]
}

type TreeStoreOptions = {
  scope: () => WorkspacePath
  normalize: (input: string) => FilePath
  normalizeDir: (input: string) => FilePath
  list: (input: FilePath) => Promise<FileNode[]>
  onError: (message: string) => void
}

export function createFileTreeStore(options: TreeStoreOptions) {
  const dirKey = (path: FilePath) => filePathKey(path)
  const nodeKey = (path: FilePath) => filePathKey(path)
  const nodePath = (node: FileNode) => (node.type === "directory" ? options.normalizeDir(node.path) : options.normalize(node.path))
  const [tree, setTree] = createStore<{
    node: Record<FilePathKey, TreeNode>
    dir: Record<FilePathKey, DirectoryState>
  }>({
    node: {},
    dir: { [ROOT_FILE_PATH_KEY]: { path: ROOT_FILE_PATH, expanded: true } },
  })

  const inflight = new Map<FilePathKey, Promise<void>>()
  const normalizeNode = (node: FileNode): TreeNode => ({
    ...node,
    path: nodePath(node),
  })

  const dropDirs = (dirs: readonly FilePathKey[]) => {
    if (dirs.length === 0) return

    setTree(
      "dir",
      produce((draft) => {
        for (const key of Object.keys(draft) as FilePathKey[]) {
          if (key === ROOT_FILE_PATH_KEY) continue
          if (!dirs.some((dir) => key === dir || filePathDescendsFrom(key, dir))) continue
          delete draft[key]
        }
      }),
    )
  }

  const reset = () => {
    inflight.clear()
    setTree("node", reconcile({}))
    setTree("dir", reconcile({}))
    setTree("dir", ROOT_FILE_PATH_KEY, { path: ROOT_FILE_PATH, expanded: true })
  }

  const ensureDir = (path: FilePath) => {
    const dir = dirKey(path)
    if (tree.dir[dir]) return
    setTree("dir", dir, { path, expanded: false })
  }

  const listDir = (input: string, opts?: { force?: boolean }) => {
    const path = options.normalizeDir(input)
    const dir = dirKey(path)
    ensureDir(path)

    const current = tree.dir[dir]
    if (!opts?.force && current?.loaded) return Promise.resolve()

    const pending = inflight.get(dir)
    if (pending) return pending

    setTree(
      "dir",
      dir,
      produce((draft) => {
        draft.loading = true
        draft.error = undefined
      }),
    )

    const directory = options.scope()

    const promise = options
      .list(path)
      .then((items) => {
        if (options.scope() !== directory) return
        const nodes = items.map(normalizeNode)
        const prevChildren = tree.dir[dir]?.children ?? []
        const nextChildren = nodes.map((node) => nodeKey(node.path))
        const nextSet = new Set(nextChildren)
        const removedDirs: FilePathKey[] = []

        setTree(
          "node",
          produce((draft) => {
            for (const child of prevChildren) {
              if (nextSet.has(child)) continue
              const existing = draft[child]
              if (existing?.type === "directory") removedDirs.push(child)
              delete draft[child]
            }

            for (const key of Object.keys(draft) as FilePathKey[]) {
              if (!removedDirs.some((dir) => filePathDescendsFrom(key, dir))) continue
              delete draft[key]
            }

            for (const node of nodes) {
              draft[nodeKey(node.path)] = node
            }
          }),
        )

        dropDirs(removedDirs)

        setTree(
          "dir",
          dir,
          produce((draft) => {
            draft.path = path
            draft.loaded = true
            draft.loading = false
            draft.children = nextChildren
          }),
        )
      })
      .catch((e) => {
        if (options.scope() !== directory) return
        setTree(
          "dir",
          dir,
          produce((draft) => {
            draft.loading = false
            draft.error = e.message
          }),
        )
        options.onError(e.message)
      })
      .finally(() => {
        inflight.delete(dir)
      })

    inflight.set(dir, promise)
    return promise
  }

  const expandDir = (input: string) => {
    const path = options.normalizeDir(input)
    const dir = dirKey(path)
    ensureDir(path)
    setTree("dir", dir, "expanded", true)
    void listDir(path)
  }

  const collapseDir = (input: string) => {
    const path = options.normalizeDir(input)
    const dir = dirKey(path)
    ensureDir(path)
    setTree("dir", dir, "expanded", false)
  }

  const dirState = (input: string) => {
    const dir = dirKey(options.normalizeDir(input))
    return tree.dir[dir]
  }

  const children = (input: string) => {
    const dir = dirKey(options.normalizeDir(input))
    return (tree.dir[dir]?.children ?? []).flatMap((id) => {
      const node = tree.node[id]
      if (!node) return []
      return [node]
    })
  }

  return {
    listDir,
    expandDir,
    collapseDir,
    dirState,
    children,
    node: (path: string) => tree.node[nodeKey(options.normalize(path))],
    nodeByKey: (key: FilePathKey) => tree.node[key],
    dirByKey: (key: FilePathKey) => tree.dir[key],
    dirPathByKey: (key: FilePathKey) => {
      const dir = tree.dir[key]
      if (!dir?.loaded) return
      return dir.path
    },
    isLoaded: (path: string) => Boolean(tree.dir[dirKey(options.normalizeDir(path))]?.loaded),
    reset,
  }
}
