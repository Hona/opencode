import { createMemo } from "solid-js"
import { useSync } from "./sync"
import { formatServerPath } from "../util/path"

export function useDirectory() {
  const sync = useSync()
  return createMemo(() => {
    const result = formatServerPath(sync.data.path.directory, sync.data.path)
    if (sync.data.vcs?.branch) return result ? result + ":" + sync.data.vcs.branch : sync.data.vcs.branch
    return result
  })
}
