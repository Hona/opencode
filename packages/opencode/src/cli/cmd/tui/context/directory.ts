import { createMemo } from "solid-js"
import { useSync } from "./sync"
import { Global } from "@/global"
import { formatPath } from "../util/path"

export function useDirectory() {
  const sync = useSync()
  return createMemo(() => {
    const directory = sync.data.path.directory || process.cwd()
    const result = formatPath(directory, {
      home: Global.Path.home,
    })
    if (sync.data.vcs?.branch) return result + ":" + sync.data.vcs.branch
    return result
  })
}
