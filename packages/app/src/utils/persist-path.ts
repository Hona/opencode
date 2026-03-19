import { pathKey } from "@opencode-ai/util/path"
import { createPathHelpers, type WorkspaceKey, type WorkspacePath } from "@/context/file/path"
import { sessionDirKey, sessionParts } from "@/utils/session-key"

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const text = (value: unknown) => (typeof value === "string" ? value : undefined)

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

const flag = (value: unknown) => (typeof value === "boolean" ? value : undefined)

const pathId = (value: WorkspacePath) => (pathKey(value) || value) as WorkspaceKey

function paths(value: unknown, skip?: string) {
  if (!Array.isArray(value)) return

  const omit = skip ? pathId(skip) : undefined
  const seen = new Set<string>()
  const out: string[] = []

  for (const item of value) {
    const cur = text(item)
    if (!cur) continue

    const id = pathId(cur)
    if (id === omit || seen.has(id)) continue
    seen.add(id)
    out.push(cur)
  }

  return out
}

function byKey<T>(
  value: unknown,
  move: (value: unknown, key: WorkspaceKey) => T | undefined,
  merge?: (prev: T, next: T) => T,
) {
  if (!record(value)) return

  const out: Record<WorkspaceKey, T> = {}
  for (const [name, item] of Object.entries(value)) {
    const id = pathId(name)
    const next = move(item, id)
    if (next === undefined) continue

    const prev = out[id]
    out[id] = prev !== undefined && merge ? merge(prev, next) : next
  }

  return out
}

function bySession<T>(value: unknown, move: (value: unknown, key: string) => T | undefined, merge?: (prev: T, next: T) => T) {
  if (!record(value)) return

  const out: Record<string, T> = {}
  for (const [name, item] of Object.entries(value)) {
    const key = sessionParts(name).key
    const next = move(item, key)
    if (next === undefined) continue

    const prev = out[key]
    out[key] = prev !== undefined && merge ? merge(prev, next) : next
  }

  return out
}

function list(value: readonly string[]) {
  const seen = new Set<string>()
  const out: string[] = []

  for (const item of value) {
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }

  return out
}

const sessionPath = (key: string) => {
  const dir = sessionParts(key).directory
  if (!dir) return
  return createPathHelpers(() => dir)
}

function tabs(value: readonly string[], key: string) {
  const path = sessionPath(key)
  if (!path) return list(value)

  const seen = new Set<string>()
  const out: string[] = []

  for (const item of value) {
    const next = path.normalizeTab(item)
    if (seen.has(next)) continue
    seen.add(next)
    out.push(next)
  }

  return out
}

function scroll(value: unknown, key: string) {
  if (!record(value)) return {}

  const path = sessionPath(key)
  if (!path) return value

  return Object.fromEntries(Object.entries(value).map(([name, item]) => [path.normalizeTab(name), item]))
}

type Route = Record<string, unknown> & {
  directory: WorkspacePath
  id: string
  at?: number
}

function route(value: unknown): Route | undefined {
  if (!record(value)) return

  const directory = text(value.directory)
  const id = text(value.id)
  if (!directory || !id) return

  const at = num(value.at)
  return {
    ...value,
    directory,
    id,
    ...(at !== undefined ? { at } : {}),
  }
}

type Project = Record<string, unknown> & {
  worktree: WorkspacePath
  expanded: boolean
}

type SessionTabs = {
  active?: string
  all: string[]
}

type SessionView = Record<string, unknown> & {
  scroll: Record<string, unknown>
  reviewOpen?: string[]
  pendingMessage?: string
  pendingMessageAt?: number
}

function project(value: unknown): Project | undefined {
  if (!record(value)) return

  const worktree = text(value.worktree)
  if (!worktree) return

  return {
    ...value,
    worktree,
    expanded: flag(value.expanded) ?? false,
  }
}

function projects(value: unknown) {
  if (!Array.isArray(value)) return

  const seen = new Map<string, number>()
  const out: Project[] = []

  for (const item of value) {
    const next = project(item)
    if (!next) continue

    const id = pathId(next.worktree)
    const at = seen.get(id)
    if (at === undefined) {
      seen.set(id, out.length)
      out.push(next)
      continue
    }

    out[at] = { ...out[at], expanded: out[at].expanded || next.expanded }
  }

  return out
}

function sessionTabs(value: unknown, key: string): SessionTabs | undefined {
  if (!record(value)) return
  if (!Array.isArray(value.all)) return

  const all = tabs(value.all.filter((item): item is string => typeof item === "string"), key)
  const active = text(value.active)

  return {
    all,
    active: active ? sessionPath(key)?.normalizeTab(active) ?? active : undefined,
  }
}

function mergeSessionTabs(prev: SessionTabs, next: SessionTabs): SessionTabs {
  return {
    all: list([...next.all, ...prev.all]),
    active: next.active ?? prev.active,
  }
}

function sessionView(value: unknown, key: string): SessionView | undefined {
  if (!record(value)) return

  return {
    ...value,
    scroll: scroll(value.scroll, key),
    ...(Array.isArray(value.reviewOpen)
      ? { reviewOpen: value.reviewOpen.filter((item): item is string => typeof item === "string") }
      : {}),
    ...(text(value.pendingMessage) ? { pendingMessage: text(value.pendingMessage) } : {}),
    ...(num(value.pendingMessageAt) !== undefined ? { pendingMessageAt: num(value.pendingMessageAt) } : {}),
  }
}

function mergeSessionView(prev: SessionView, next: SessionView): SessionView {
  const pending = (next.pendingMessageAt ?? -Infinity) >= (prev.pendingMessageAt ?? -Infinity)
  return {
    ...prev,
    ...next,
    scroll: { ...prev.scroll, ...next.scroll },
    ...(next.reviewOpen ? { reviewOpen: next.reviewOpen } : prev.reviewOpen ? { reviewOpen: prev.reviewOpen } : {}),
    ...(pending
      ? {
          ...(next.pendingMessage ? { pendingMessage: next.pendingMessage } : prev.pendingMessage ? { pendingMessage: prev.pendingMessage } : {}),
          ...(next.pendingMessageAt !== undefined
            ? { pendingMessageAt: next.pendingMessageAt }
            : prev.pendingMessageAt !== undefined
              ? { pendingMessageAt: prev.pendingMessageAt }
              : {}),
        }
      : {
          ...(prev.pendingMessage ? { pendingMessage: prev.pendingMessage } : {}),
          ...(prev.pendingMessageAt !== undefined ? { pendingMessageAt: prev.pendingMessageAt } : {}),
        }),
  }
}

export function migrateLayoutPaths(value: unknown) {
  if (!record(value)) return value

  const sidebar = value.sidebar
  const nextSidebar = (() => {
    if (!record(sidebar)) return sidebar
    if (typeof sidebar.workspaces === "boolean") {
      return {
        ...sidebar,
        workspaces: {},
        workspacesDefault: sidebar.workspaces,
      }
    }

    const workspaces = byKey(sidebar.workspaces, (item) => flag(item))
    if (!workspaces) return sidebar
    return {
      ...sidebar,
      workspaces,
    }
  })()
  const sessionTabsMap = bySession(value.sessionTabs, (item, key) => sessionTabs(item, key), mergeSessionTabs)
  const sessionViewMap = bySession(value.sessionView, (item, key) => sessionView(item, key), mergeSessionView)
  const handoff = (() => {
    if (!record(value.handoff)) return value.handoff
    if (!record(value.handoff.tabs)) return value.handoff
    const dir = text(value.handoff.tabs.dir)
    if (!dir) return value.handoff
    return {
      ...value.handoff,
      tabs: {
        ...value.handoff.tabs,
        dir: sessionDirKey(dir),
      },
    }
  })()

  if (nextSidebar === sidebar && !sessionTabsMap && !sessionViewMap && handoff === value.handoff) return value

  return {
    ...value,
    ...(nextSidebar !== sidebar ? { sidebar: nextSidebar } : {}),
    ...(sessionTabsMap ? { sessionTabs: sessionTabsMap } : {}),
    ...(sessionViewMap ? { sessionView: sessionViewMap } : {}),
    ...(handoff !== value.handoff ? { handoff } : {}),
  }
}

export function migrateLayoutPageState(value: unknown) {
  if (!record(value)) return value

  const lastProjectSession = byKey(value.lastProjectSession, (item) => route(item), (prev, next) => {
    if ((next.at ?? -Infinity) >= (prev.at ?? -Infinity)) return next
    return prev
  })

  const workspaceOrder = byKey(value.workspaceOrder, (item, id) => paths(item, id) ?? [])
  const workspaceName = byKey(value.workspaceName, (item) => text(item))
  const workspaceExpanded = byKey(value.workspaceExpanded, (item) => flag(item))

  return {
    ...value,
    ...(lastProjectSession ? { lastProjectSession } : {}),
    ...(workspaceOrder ? { workspaceOrder } : {}),
    ...(workspaceName ? { workspaceName } : {}),
    ...(workspaceExpanded ? { workspaceExpanded } : {}),
  }
}

export function migrateServerState(value: unknown) {
  if (!record(value)) return value

  const lastProject = record(value.lastProject)
    ? Object.fromEntries(
        Object.entries(value.lastProject).flatMap(([key, item]) => {
          const next = text(item)
          if (!next) return []
          return [[key, next] as const]
        }),
      )
    : undefined

  const projectsByServer = record(value.projects)
    ? Object.fromEntries(
        Object.entries(value.projects).map(([key, item]) => {
          return [key, projects(item) ?? []] as const
        }),
      )
    : undefined

  return {
    ...value,
    ...(lastProject ? { lastProject } : {}),
    ...(projectsByServer ? { projects: projectsByServer } : {}),
  }
}
