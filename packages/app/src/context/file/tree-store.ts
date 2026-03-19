import { createStore, produce, reconcile } from "solid-js/store"
import type { FileNode } from "@opencode-ai/sdk/v2"
import { filePathKey, type FilePath, type FilePathKey, type WorkspacePath } from "./path"

type TreeNode = FileNode & { path: FilePath }

type DirectoryState = {
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
  const ROOT = "" as FilePathKey
  const dirKey = (path: string) => (filePathKey(options.normalizeDir(path)) || options.normalizeDir(path)) as FilePathKey
  const nodeKey = (path: string) => (filePathKey(options.normalize(path)) || options.normalize(path)) as FilePathKey
  const nodePath = (node: FileNode) => (node.type === "directory" ? options.normalizeDir(node.path) : options.normalize(node.path))
  const [tree, setTree] = createStore<{
    node: Record<FilePathKey, TreeNode>
    dir: Record<FilePathKey, DirectoryState>
  }>({
    node: {},
    dir: { [ROOT]: { expanded: true } },
  })

  const inflight = new Map<FilePathKey, Promise<void>>()
  const normalizeNode = (node: FileNode): TreeNode => ({
    ...node,
    path: nodePath(node),
  })

  const reset = () => {
    inflight.clear()
    setTree("node", reconcile({}))
    setTree("dir", reconcile({}))
    setTree("dir", ROOT, { expanded: true })
  }

  const ensureDir = (path: string) => {
    const dir = dirKey(path)
    if (tree.dir[dir]) return
    setTree("dir", dir, { expanded: false })
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

        setTree(
          "node",
          produce((draft) => {
            const removedDirs: FilePathKey[] = []

            for (const child of prevChildren) {
              if (nextSet.has(child)) continue
              const existing = draft[child]
              if (existing?.type === "directory") removedDirs.push(child)
              delete draft[child]
            }

            if (removedDirs.length > 0) {
              const keys = Object.keys(draft) as FilePathKey[]
              for (const key of keys) {
                for (const removed of removedDirs) {
                  if (!key.startsWith(removed + "/")) continue
                  delete draft[key]
                  break
                }
              }
            }

            for (const node of nodes) {
              draft[nodeKey(node.path)] = node
            }
          }),
        )

        setTree(
          "dir",
          dir,
          produce((draft) => {
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
    const dir = dirKey(input)
    return tree.dir[dir]
  }

  const children = (input: string) => {
    const dir = dirKey(input)
    const ids = tree.dir[dir]?.children
    if (!ids) return []
    const out: TreeNode[] = []
    for (const id of ids) {
      const node = tree.node[id]
      if (node) out.push(node)
    }
    return out
  }

  return {
    listDir,
    expandDir,
    collapseDir,
    dirState,
    children,
    node: (path: string) => tree.node[nodeKey(path)],
    isLoaded: (path: string) => Boolean(tree.dir[dirKey(path)]?.loaded),
    reset,
  }
}
