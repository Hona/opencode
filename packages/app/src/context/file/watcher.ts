import { filePathKey, filePathParentKey, type FilePath, type FilePathKey } from "./path"

type WatcherEvent = {
  type: string
  properties: unknown
}

type WatcherOps = {
  normalize: (input: string) => FilePath
  file: (key: FilePathKey) => FilePath | undefined
  open?: (key: FilePathKey) => FilePath | undefined
  dir: (key: FilePathKey) => FilePath | undefined
  loadFile: (path: FilePath) => void
  refreshDir: (path: FilePath) => void
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
  const key = filePathKey(path)
  if (key.startsWith(".git/")) return

  const file = ops.file(key) ?? ops.open?.(key)
  if (file) ops.loadFile(file)

  if (kind === "change") {
    const dir = ops.dir(key)
    if (!dir) return
    ops.refreshDir(dir)
    return
  }
  if (kind !== "add" && kind !== "unlink") return

  const parent = ops.dir(filePathParentKey(key))
  if (!parent) return
  ops.refreshDir(parent)
}
