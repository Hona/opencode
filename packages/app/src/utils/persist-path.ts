import { pathKey } from "@opencode-ai/util/path"

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const text = (value: unknown) => (typeof value === "string" ? value : undefined)

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

const flag = (value: unknown) => (typeof value === "boolean" ? value : undefined)

const dir = (value: string) => pathKey(value) || value

function dirs(value: unknown, skip?: string) {
  if (!Array.isArray(value)) return

  const omit = skip ? dir(skip) : undefined
  const seen = new Set<string>()
  const out: string[] = []

  for (const item of value) {
    const cur = text(item)
    if (!cur) continue

    const next = dir(cur)
    if (next === omit || seen.has(next)) continue
    seen.add(next)
    out.push(next)
  }

  return out
}

function byDir<T>(
  value: unknown,
  move: (value: unknown, key: string) => T | undefined,
  merge?: (prev: T, next: T) => T,
) {
  if (!record(value)) return

  const out: Record<string, T> = {}
  for (const [key, item] of Object.entries(value)) {
    const id = dir(key)
    const next = move(item, id)
    if (next === undefined) continue

    const prev = out[id]
    out[id] = prev !== undefined && merge ? merge(prev, next) : next
  }

  return out
}

type Route = Record<string, unknown> & {
  directory: string
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
    directory: dir(directory),
    id,
    ...(at !== undefined ? { at } : {}),
  }
}

type Project = Record<string, unknown> & {
  worktree: string
  expanded: boolean
}

function project(value: unknown): Project | undefined {
  if (!record(value)) return

  const worktree = text(value.worktree)
  if (!worktree) return

  return {
    ...value,
    worktree: dir(worktree),
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

    const at = seen.get(next.worktree)
    if (at === undefined) {
      seen.set(next.worktree, out.length)
      out.push(next)
      continue
    }

    out[at] = { ...out[at], expanded: out[at].expanded || next.expanded }
  }

  return out
}

export function migrateLayoutPaths(value: unknown) {
  if (!record(value)) return value

  const sidebar = value.sidebar
  if (!record(sidebar)) return value

  if (typeof sidebar.workspaces === "boolean") {
    return {
      ...value,
      sidebar: {
        ...sidebar,
        workspaces: {},
        workspacesDefault: sidebar.workspaces,
      },
    }
  }

  const workspaces = byDir(sidebar.workspaces, (item) => flag(item))
  if (!workspaces) return value

  return {
    ...value,
    sidebar: {
      ...sidebar,
      workspaces,
    },
  }
}

export function migrateLayoutPageState(value: unknown) {
  if (!record(value)) return value

  const lastProjectSession = byDir(value.lastProjectSession, (item) => route(item), (prev, next) => {
    if ((next.at ?? -Infinity) >= (prev.at ?? -Infinity)) return next
    return prev
  })

  const workspaceOrder = byDir(value.workspaceOrder, (item, key) => dirs(item, key) ?? [])
  const workspaceName = byDir(value.workspaceName, (item) => text(item))
  const workspaceExpanded = byDir(value.workspaceExpanded, (item) => flag(item))
  const activeProject = text(value.activeProject)
  const activeWorkspace = text(value.activeWorkspace)

  return {
    ...value,
    activeProject: activeProject ? dir(activeProject) : activeProject,
    activeWorkspace: activeWorkspace ? dir(activeWorkspace) : activeWorkspace,
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
          return [[key, dir(next)] as const]
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
