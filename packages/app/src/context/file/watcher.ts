import type { FileNode } from "@opencode-ai/sdk/v2"
import { getParentPath, pathKey } from "@opencode-ai/util/path"

type WatcherEvent = {
  type: string
  properties: unknown
}

type WatcherOps = {
  normalize: (input: string) => string
  hasFile: (path: string) => boolean
  isOpen?: (path: string) => boolean
  loadFile: (path: string) => void
  node: (path: string) => FileNode | undefined
  isDirLoaded: (path: string) => boolean
  refreshDir: (path: string) => void
}

export function invalidateFromWatcher(event: WatcherEvent, ops: WatcherOps) {
  if (event.type !== "file.watcher.updated") return
  const props =
    typeof event.properties === "object" && event.properties ? (event.properties as Record<string, unknown>) : undefined
  const rawPath = typeof props?.file === "string" ? props.file : undefined
  const kind = typeof props?.event === "string" ? props.event : undefined
  if (!rawPath) return
  if (!kind) return

  const path = ops.normalize(rawPath)
  if (!path) return
  const key = pathKey(path) || path
  if (key.startsWith(".git/")) return

  const file = (() => {
    if (ops.hasFile(path) || ops.isOpen?.(path)) return path
    if (key === path) return
    if (ops.hasFile(key) || ops.isOpen?.(key)) return key
  })()

  if (file) {
    ops.loadFile(file)
  }

  if (kind === "change") {
    const dir = (() => {
      if (path === "") return ""
      const node = ops.node(path) ?? (key === path ? undefined : ops.node(key))
      if (node?.type !== "directory") return
      return node.path
    })()
    if (dir === undefined) return
    if (!ops.isDirLoaded(dir)) return
    ops.refreshDir(dir)
    return
  }
  if (kind !== "add" && kind !== "unlink") return

  const parent = getParentPath(key)
  if (!ops.isDirLoaded(parent)) return

  ops.refreshDir(parent)
}
