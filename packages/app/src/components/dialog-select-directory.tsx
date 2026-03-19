import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { List } from "@opencode-ai/ui/list"
import type { ListRef } from "@opencode-ai/ui/list"
import {
  getDirectory,
  getFilename,
  joinPath,
  normalizeInputPath,
  getParentPath,
  getPathDisplay,
  getPathDisplaySeparator,
  getPathRoot,
  getPathScope,
  getPathSearchText,
  trimPrettyPath,
} from "@opencode-ai/util/path"
import fuzzysort from "fuzzysort"
import { createMemo, createResource, createSignal } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { workspacePathKey } from "@/context/file/path"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"

interface DialogSelectDirectoryProps {
  title?: string
  multiple?: boolean
  onSelect: (result: string | string[] | null) => void
}

type Row = {
  absolute: string
  search: string
  group: "recent" | "folders"
}

function cleanInput(value: string) {
  const first = (value ?? "").split(/\r?\n/)[0] ?? ""
  return first.replace(/[\u0000-\u001F\u007F]/g, "").trim()
}

function toRow(absolute: string, home: string, group: Row["group"]): Row {
  const full = trimPrettyPath(absolute)
  return { absolute: full, search: getPathSearchText(full, home), group }
}

function uniqueRows(rows: Row[]) {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = workspacePathKey(row.absolute)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function unique(paths: string[]) {
  const seen = new Set<string>()
  return paths.filter((path) => {
    const key = workspacePathKey(path)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function useDirectorySearch(args: {
  sdk: ReturnType<typeof useGlobalSDK>
  start: () => string | undefined
  home: () => string
}) {
  const cache = new Map<string, Promise<Array<{ name: string; absolute: string }>>>()
  let current = 0

  const dirs = async (dir: string) => {
    const path = trimPrettyPath(dir)
    const key = workspacePathKey(path)
    const existing = cache.get(key)
    if (existing) return existing

    const request = args.sdk.client.file
      .list({ directory: path, path })
      .then((x) => x.data ?? [])
      .catch(() => [])
      .then((nodes) =>
        nodes
          .filter((n) => n.type === "directory")
          .map((n) => ({
            name: n.name,
            absolute: trimPrettyPath(n.absolute),
          })),
      )

    cache.set(key, request)
    return request
  }

  const match = async (dir: string, query: string, limit: number) => {
    const items = await dirs(dir)
    if (!query) return items.slice(0, limit).map((x) => x.absolute)
    return fuzzysort.go(query, items, { key: "name", limit }).map((x) => x.obj.absolute)
  }

  return async (filter: string) => {
    const token = ++current
    const active = () => token === current

    const value = cleanInput(filter)
    const scopedInput = getPathScope(value, args.start(), args.home())
    if (!scopedInput) return [] as string[]

    const raw = normalizeInputPath(value)
    const isPath = raw.startsWith("~") || !!getPathRoot(raw) || /[\\/]/.test(value)
    const query = normalizeInputPath(scopedInput.path)

    const find = () =>
      args.sdk.client.find
        .files({ directory: scopedInput.directory, query, type: "directory", limit: 50 })
        .then((x) => x.data ?? [])
        .catch(() => [])

    if (!isPath) {
      const results = await find()
      if (!active()) return []
      return results.map((rel) => joinPath(scopedInput.directory, rel)).slice(0, 50)
    }

    const segments = query.replace(/^\/+/, "").split("/")
    const head = segments.slice(0, segments.length - 1).filter((x) => x && x !== ".")
    const tail = segments[segments.length - 1] ?? ""

    const cap = 12
    const branch = 4
    let paths = [scopedInput.directory]
    for (const part of head) {
      if (!active()) return []
      if (part === "..") {
        paths = paths.map(getParentPath)
        continue
      }

      const next = (await Promise.all(paths.map((p) => match(p, part, branch)))).flat()
      if (!active()) return []
      paths = unique(next).slice(0, cap)
      if (paths.length === 0) return [] as string[]
    }

    const out = (await Promise.all(paths.map((p) => match(p, tail, 50)))).flat()
    if (!active()) return []
    const deduped = unique(out)
    const base = raw.startsWith("~") ? scopedInput.directory : ""
    const expand = !raw.endsWith("/")
    if (!expand || !tail) {
      const items = base ? unique([base, ...deduped]) : deduped
      return items.slice(0, 50)
    }

    const needle = tail.toLowerCase()
    const exact = deduped.filter((p) => getFilename(p).toLowerCase() === needle)
    const target = exact[0]
    if (!target) return deduped.slice(0, 50)

    const children = await match(target, "", 30)
    if (!active()) return []
    const items = unique([...deduped, ...children])
    return (base ? unique([base, ...items]) : items).slice(0, 50)
  }
}

export function DialogSelectDirectory(props: DialogSelectDirectoryProps) {
  const sync = useGlobalSync()
  const sdk = useGlobalSDK()
  const layout = useLayout()
  const dialog = useDialog()
  const language = useLanguage()

  const [filter, setFilter] = createSignal("")
  let list: ListRef | undefined

  const missingBase = createMemo(() => !(sync.data.path.home || sync.data.path.directory))
  const [fallbackPath] = createResource(
    () => (missingBase() ? true : undefined),
    async () => {
      return sdk.client.path
        .get()
        .then((x) => x.data)
        .catch(() => undefined)
    },
    { initialValue: undefined },
  )

  const home = createMemo(() => sync.data.path.home || fallbackPath()?.home || "")
  const start = createMemo(
    () => sync.data.path.home || sync.data.path.directory || fallbackPath()?.home || fallbackPath()?.directory,
  )

  const directories = useDirectorySearch({
    sdk,
    home,
    start,
  })

  const recentProjects = createMemo(() => {
    const projects = layout.projects.list()
    const byProject = new Map<string, number>()

    for (const project of projects) {
      let at = 0
      const dirs = [project.worktree, ...(project.sandboxes ?? [])]
      for (const directory of dirs) {
        const sessions = sync.child(directory, { bootstrap: false })[0].session
        for (const session of sessions) {
          if (session.time.archived) continue
          const updated = session.time.updated ?? session.time.created
          if (updated > at) at = updated
        }
      }
      byProject.set(project.worktree, at)
    }

    return projects
      .map((project, index) => ({ project, at: byProject.get(project.worktree) ?? 0, index }))
      .sort((a, b) => b.at - a.at || a.index - b.index)
      .slice(0, 5)
      .map(({ project }) => {
        const row = toRow(project.worktree, home(), "recent")
        const name = project.name || getFilename(project.worktree)
        return {
          ...row,
          search: `${row.search}\n${name}`,
        }
      })
  })

  const items = async (value: string) => {
    const results = await directories(value)
    const directoryRows = results.map((absolute) => toRow(absolute, home(), "folders"))
    return uniqueRows([...recentProjects(), ...directoryRows])
  }

  function resolve(absolute: string) {
    props.onSelect(props.multiple ? [absolute] : absolute)
    dialog.close()
  }

  return (
    <Dialog title={props.title ?? language.t("command.project.open")}>
      <List
        search={{ placeholder: language.t("dialog.directory.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.directory.empty")}
        loadingMessage={language.t("common.loading")}
        items={items}
        key={(x) => x.absolute}
        filterKeys={["search"]}
        groupBy={(item) => item.group}
        sortGroupsBy={(a, b) => {
          if (a.category === b.category) return 0
          return a.category === "recent" ? -1 : 1
        }}
        groupHeader={(group) =>
          group.category === "recent" ? language.t("home.recentProjects") : language.t("command.project.open")
        }
        ref={(r) => (list = r)}
        onFilter={(value) => setFilter(cleanInput(value))}
        onKeyEvent={(e, item) => {
          if (e.key !== "Tab") return
          if (e.shiftKey) return
          if (!item) return

          e.preventDefault()
          e.stopPropagation()

          const value = getPathDisplay(item.absolute, filter(), home())
          const sep = getPathDisplaySeparator(value, home())
          list?.setFilter(/[\\/]$/.test(value) ? value : value + sep)
        }}
        onSelect={(path) => {
          if (!path) return
          resolve(path.absolute)
        }}
      >
        {(item) => {
          const path = getPathDisplay(item.absolute, filter(), home())
          const dir = getDirectory(path)
          const sep = getPathDisplaySeparator(path, home())
          if (path === "~") {
            return (
              <div class="w-full flex items-center justify-between rounded-md">
                <div class="flex items-center gap-x-3 grow min-w-0">
                  <FileIcon node={{ path: item.absolute, type: "directory" }} class="shrink-0 size-4" />
                  <div class="flex items-center text-14-regular min-w-0">
                    <span class="text-text-strong whitespace-nowrap">~</span>
                    <span class="text-text-weak whitespace-nowrap">{sep}</span>
                  </div>
                </div>
              </div>
            )
          }
          return (
            <div class="w-full flex items-center justify-between rounded-md">
              <div class="flex items-center gap-x-3 grow min-w-0">
                <FileIcon node={{ path: item.absolute, type: "directory" }} class="shrink-0 size-4" />
                <div class="flex items-center text-14-regular min-w-0">
                  <span class="text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                    {dir}
                  </span>
                  <span class="text-text-strong whitespace-nowrap">{getFilename(path)}</span>
                  <span class="text-text-weak whitespace-nowrap">{sep}</span>
                </div>
              </div>
            </div>
          )
        }}
      </List>
    </Dialog>
  )
}
