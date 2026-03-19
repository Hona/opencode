import { pathKey } from "@opencode-ai/util/path"

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const text = (value: unknown) => (typeof value === "string" ? value : undefined)

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

const flag = (value: unknown) => (typeof value === "boolean" ? value : undefined)

const pathId = (value: string) => pathKey(value) || value

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
  move: (value: unknown, key: string) => T | undefined,
  merge?: (prev: T, next: T) => T,
) {
  if (!record(value)) return

  const out: Record<string, T> = {}
  for (const [name, item] of Object.entries(value)) {
    const id = pathId(name)
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
    directory,
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

  const workspaces = byKey(sidebar.workspaces, (item) => flag(item))
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
