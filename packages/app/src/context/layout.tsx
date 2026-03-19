import { createStore, produce } from "solid-js/store"
import { batch, createEffect, createMemo, onCleanup, onMount, type Accessor } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { pathEqual } from "@opencode-ai/util/path"
import { useGlobalSync } from "./global-sync"
import { useGlobalSDK } from "./global-sdk"
import { useServer } from "./server"
import { usePlatform } from "./platform"
import { Project } from "@opencode-ai/sdk/v2"
import { Persist, persisted, removePersisted } from "@/utils/persist"
import { migrateLayoutPaths } from "@/utils/persist-path"
import { normalizeSessionKey, sessionDirKey, sessionParts, sessionPathHelpers } from "@/utils/session-key"
import { same } from "@/utils/same"
import { createScrollPersistence, type SessionScroll } from "./layout-scroll"
import { reviewPathKey, workspacePathKey, type ReviewPath, type WorkspaceKey, type WorkspacePath } from "./file/path"

const AVATAR_COLOR_KEYS = ["pink", "mint", "orange", "purple", "cyan", "lime"] as const
const DEFAULT_PANEL_WIDTH = 344
const DEFAULT_SESSION_WIDTH = 600
const DEFAULT_TERMINAL_HEIGHT = 280
const reviewPaths = (paths: readonly ReviewPath[]) => {
  const seen = new Set<string>()
  const out: ReviewPath[] = []

  for (const path of paths) {
    const id = reviewPathKey(path)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(path)
  }

  return out
}
const sameReviewPaths = (a: readonly ReviewPath[] | undefined, b: readonly ReviewPath[] | undefined) => {
  if (!a && !b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  return a.every((path, idx) => pathEqual(path, b[idx]))
}
export type AvatarColorKey = (typeof AVATAR_COLOR_KEYS)[number]

export function getAvatarColors(key?: string) {
  if (key && AVATAR_COLOR_KEYS.includes(key as AvatarColorKey)) {
    return {
      background: `var(--avatar-background-${key})`,
      foreground: `var(--avatar-text-${key})`,
    }
  }
  return {
    background: "var(--surface-info-base)",
    foreground: "var(--text-base)",
  }
}

type SessionTabs = {
  active?: string
  all: string[]
}

type SessionView = {
  scroll: Record<string, SessionScroll>
  reviewOpen?: ReviewPath[]
  pendingMessage?: string
  pendingMessageAt?: number
}

type TabHandoff = {
  dir: string
  id: string
  at: number
}

export type LocalProject = Partial<Project> & { worktree: WorkspacePath; expanded: boolean }

export type ReviewDiffStyle = "unified" | "split"

export function ensureSessionKey(key: string, touch: (key: string) => void, seed: (key: string) => void) {
  const next = normalizeSessionKey(key)
  touch(next)
  seed(next)
  return next
}

export function createSessionKeyReader(sessionKey: string | Accessor<string>, ensure: (key: string) => string) {
  const key = typeof sessionKey === "function" ? sessionKey : () => sessionKey
  return () => {
    const value = key()
    return ensure(value)
  }
}

export function pruneSessionKeys(input: {
  keep?: string
  max: number
  used: Map<string, number>
  view: string[]
  tabs: string[]
}) {
  if (!input.keep) return []

  const keys = new Set<string>([...input.view, ...input.tabs])
  if (keys.size <= input.max) return []

  const score = (key: string) => {
    if (key === input.keep) return Number.MAX_SAFE_INTEGER
    return input.used.get(key) ?? 0
  }

  return Array.from(keys)
    .sort((a, b) => score(b) - score(a))
    .slice(input.max)
}

function nextSessionTabsForOpen(current: SessionTabs | undefined, tab: string): SessionTabs {
  const all = current?.all ?? []
  if (tab === "review") return { all: all.filter((x) => x !== "review"), active: tab }
  if (tab === "context") return { all: [tab, ...all.filter((x) => x !== tab)], active: tab }
  if (!all.includes(tab)) return { all: [...all, tab], active: tab }
  return { all, active: tab }
}

const normalizeSessionTab = (path: ReturnType<typeof sessionPathHelpers>, tab: string) => {
  if (!path) return tab
  return path.normalizeTab(tab)
}

const normalizeSessionTabList = (path: ReturnType<typeof sessionPathHelpers>, all: string[]) => {
  const seen = new Set<string>()
  return all.flatMap((tab) => {
    const value = normalizeSessionTab(path, tab)
    if (seen.has(value)) return []
    seen.add(value)
    return [value]
  })
}

export const normalizeStoredSessionTabs = (key: string, tabs: SessionTabs) => {
  const path = sessionPathHelpers(key)
  return {
    all: normalizeSessionTabList(path, tabs.all),
    active: tabs.active ? normalizeSessionTab(path, tabs.active) : tabs.active,
  }
}

export const { use: useLayout, provider: LayoutProvider } = createSimpleContext({
  name: "Layout",
  init: () => {
    const globalSdk = useGlobalSDK()
    const globalSync = useGlobalSync()
    const server = useServer()
    const platform = usePlatform()

    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value)

    const migrate = (input: unknown) => {
      const value = migrateLayoutPaths(input)
      if (!isRecord(value)) return value

      const review = value.review
      const fileTree = value.fileTree
      const migratedFileTree = (() => {
        if (!isRecord(fileTree)) return fileTree
        if (fileTree.tab === "changes" || fileTree.tab === "all") return fileTree

        const width = typeof fileTree.width === "number" ? fileTree.width : DEFAULT_PANEL_WIDTH
        return {
          ...fileTree,
          opened: true,
          width: width === 260 ? DEFAULT_PANEL_WIDTH : width,
          tab: "changes",
        }
      })()

      const migratedReview = (() => {
        if (!isRecord(review)) return review
        if (typeof review.panelOpened === "boolean") return review

        const opened = isRecord(fileTree) && typeof fileTree.opened === "boolean" ? fileTree.opened : true
        return {
          ...review,
          panelOpened: opened,
        }
      })()

      const sessionTabs = value.sessionTabs
      const migratedSessionTabs = (() => {
        if (!isRecord(sessionTabs)) return sessionTabs

        let changed = false
        const next = Object.fromEntries(
          Object.entries(sessionTabs).map(([key, tabs]) => {
            if (!isRecord(tabs) || !Array.isArray(tabs.all)) return [key, tabs]

            const current = {
              all: tabs.all.filter((tab): tab is string => typeof tab === "string"),
              active: typeof tabs.active === "string" ? tabs.active : undefined,
            }
            const normalized = normalizeStoredSessionTabs(key, current)
            if (current.all.length !== tabs.all.length) changed = true
            if (!same(current.all, normalized.all) || current.active !== normalized.active) changed = true
            if (tabs.active !== undefined && typeof tabs.active !== "string") changed = true
            return [key, normalized]
          }),
        )

        if (!changed) return sessionTabs
        return next
      })()

      if (migratedReview === review && migratedFileTree === fileTree && migratedSessionTabs === sessionTabs) {
        return value
      }

      return {
        ...value,
        review: migratedReview,
        fileTree: migratedFileTree,
        sessionTabs: migratedSessionTabs,
      }
    }

    const target = Persist.global("layout", ["layout.v6"])
    const [store, setStore, _, ready] = persisted(
      { ...target, migrate },
      createStore({
        sidebar: {
          opened: false,
          width: DEFAULT_PANEL_WIDTH,
          workspaces: {} as Record<WorkspaceKey, boolean>,
          workspacesDefault: false,
        },
        terminal: {
          height: DEFAULT_TERMINAL_HEIGHT,
          opened: false,
        },
        review: {
          diffStyle: "split" as ReviewDiffStyle,
          panelOpened: true,
        },
        fileTree: {
          opened: true,
          width: DEFAULT_PANEL_WIDTH,
          tab: "changes" as "changes" | "all",
        },
        session: {
          width: DEFAULT_SESSION_WIDTH,
        },
        mobileSidebar: {
          opened: false,
        },
        sessionTabs: {} as Record<string, SessionTabs>,
        sessionView: {} as Record<string, SessionView>,
        handoff: {
          tabs: undefined as TabHandoff | undefined,
        },
      }),
    )

    const MAX_SESSION_KEYS = 50
    const PENDING_MESSAGE_TTL_MS = 2 * 60 * 1000
    const usage = {
      active: undefined as string | undefined,
      pruned: false,
      used: new Map<string, number>(),
    }

    const SESSION_STATE_KEYS = [
      { key: "prompt", legacy: "prompt", version: "v2" },
      { key: "terminal", legacy: "terminal", version: "v1" },
      { key: "file-view", legacy: "file", version: "v1" },
    ] as const

    const dropSessionState = (keys: string[]) => {
      for (const key of keys) {
        const parts = sessionParts(key)
        const dir = parts.directory
        const session = parts.id
        if (!dir) continue

        for (const entry of SESSION_STATE_KEYS) {
          const target = session ? Persist.session(dir, session, entry.key) : Persist.workspace(dir, entry.key)
          void removePersisted(target, platform)

          for (const legacy of Persist.legacyScoped(dir, session, entry.legacy, entry.version)) {
            void removePersisted({ key: legacy }, platform)
          }
        }
      }
    }

    function prune(keep?: string) {
      const drop = pruneSessionKeys({
        keep,
        max: MAX_SESSION_KEYS,
        used: usage.used,
        view: Object.keys(store.sessionView),
        tabs: Object.keys(store.sessionTabs),
      })
      if (drop.length === 0) return

      setStore(
        produce((draft) => {
          for (const key of drop) {
            delete draft.sessionView[key]
            delete draft.sessionTabs[key]
          }
        }),
      )

      scroll.drop(drop)
      dropSessionState(drop)

      for (const key of drop) {
        usage.used.delete(key)
      }
    }

    function touch(sessionKey: string) {
      usage.active = sessionKey
      usage.used.set(sessionKey, Date.now())

      if (!ready()) return
      if (usage.pruned) return

      usage.pruned = true
      prune(sessionKey)
    }

    const scroll = createScrollPersistence({
      debounceMs: 250,
      getSnapshot: (sessionKey) => store.sessionView[sessionKey]?.scroll,
      onFlush: (sessionKey, next) => {
        const current = store.sessionView[sessionKey]
        const keep = usage.active ?? sessionKey
        if (!current) {
          setStore("sessionView", sessionKey, { scroll: next })
          prune(keep)
          return
        }

        setStore("sessionView", sessionKey, "scroll", (prev) => ({ ...(prev ?? {}), ...next }))
        prune(keep)
      },
    })

    const ensureKey = (key: string) => ensureSessionKey(key, touch, (sessionKey) => scroll.seed(sessionKey))

    createEffect(() => {
      if (!ready()) return
      if (usage.pruned) return
      const active = usage.active
      if (!active) return
      usage.pruned = true
      prune(active)
    })

    onMount(() => {
      const flush = () => batch(() => scroll.flushAll())
      const handleVisibility = () => {
        if (document.visibilityState !== "hidden") return
        flush()
      }

      window.addEventListener("pagehide", flush)
      document.addEventListener("visibilitychange", handleVisibility)

      onCleanup(() => {
        window.removeEventListener("pagehide", flush)
        document.removeEventListener("visibilitychange", handleVisibility)
        scroll.dispose()
      })
    })

    const [colors, setColors] = createStore<Record<string, AvatarColorKey>>({})
    const colorRequested = new Map<string, AvatarColorKey>()

    function pickAvailableColor(used: Set<string>): AvatarColorKey {
      const available = AVATAR_COLOR_KEYS.filter((c) => !used.has(c))
      if (available.length === 0) return AVATAR_COLOR_KEYS[Math.floor(Math.random() * AVATAR_COLOR_KEYS.length)]
      return available[Math.floor(Math.random() * available.length)]
    }

    function enrich(project: { worktree: WorkspacePath; expanded: boolean }) {
      const [childStore] = globalSync.child(project.worktree, { bootstrap: false })
      const projectID = childStore.project
      const metadata = projectID
        ? globalSync.data.project.find((x) => x.id === projectID)
        : globalSync.data.project.find((x) => pathEqual(x.worktree, project.worktree))

      const local = childStore.projectMeta
      const localOverride =
        local?.name !== undefined ||
        local?.commands?.start !== undefined ||
        local?.icon?.override !== undefined ||
        local?.icon?.color !== undefined

      const base = {
        ...(metadata ?? {}),
        ...project,
        icon: {
          url: metadata?.icon?.url,
          override: metadata?.icon?.override ?? childStore.icon,
          color: metadata?.icon?.color,
        },
      }

      const isGlobal = projectID === "global" || (metadata?.id === undefined && localOverride)
      if (!isGlobal) return base

      return {
        ...base,
        id: base.id ?? "global",
        name: local?.name,
        commands: local?.commands,
        icon: {
          url: base.icon?.url,
          override: local?.icon?.override,
          color: local?.icon?.color,
        },
      }
    }

    const roots = createMemo(() => {
      const map = new Map<WorkspaceKey, WorkspacePath>()
      for (const project of globalSync.data.project) {
        const sandboxes = project.sandboxes ?? []
        for (const sandbox of sandboxes) {
          map.set(workspacePathKey(sandbox), project.worktree)
        }
      }
      return map
    })

    const rootFor = (directory: WorkspacePath) => {
      const map = roots()
      if (map.size === 0) return directory

      const visited = new Set<WorkspaceKey>()
      const chain = [directory]

      while (chain.length) {
        const current = chain[chain.length - 1]
        if (!current) return directory

        const key = workspacePathKey(current)
        const next = map.get(key)
        if (!next) return current

        const id = workspacePathKey(next)
        if (visited.has(id)) return directory
        visited.add(id)
        chain.push(next)
      }

      return directory
    }

    createEffect(() => {
      const projects = server.projects.list()
      const seen = new Set(projects.map((project) => workspacePathKey(project.worktree)))

      batch(() => {
        for (const project of projects) {
          const root = rootFor(project.worktree)
          if (pathEqual(root, project.worktree)) continue

          server.projects.close(project.worktree)

          const key = workspacePathKey(root)
          if (!seen.has(key)) {
            server.projects.open(root)
            seen.add(key)
          }

          if (project.expanded) server.projects.expand(root)
        }
      })
    })

    const enriched = createMemo(() => server.projects.list().map(enrich))
    const list = createMemo(() => {
      const projects = enriched()
      return projects.map((project) => {
        const color = project.icon?.color ?? colors[project.worktree]
        if (!color) return project
        const icon = project.icon ? { ...project.icon, color } : { color }
        return { ...project, icon }
      })
    })

    createEffect(() => {
      const projects = enriched()
      if (projects.length === 0) return
      if (!globalSync.ready) return

      for (const project of projects) {
        if (!project.id) continue
        if (project.id === "global") continue
        globalSync.project.icon(project.worktree, project.icon?.override)
      }
    })

    createEffect(() => {
      const projects = enriched()
      if (projects.length === 0) return

      for (const project of projects) {
        if (project.icon?.color) colorRequested.delete(project.worktree)
      }

      const used = new Set<string>()
      for (const project of projects) {
        const color = project.icon?.color ?? colors[project.worktree]
        if (color) used.add(color)
      }

      for (const project of projects) {
        if (project.icon?.color) continue
        const worktree = project.worktree
        const existing = colors[worktree]
        const color = existing ?? pickAvailableColor(used)
        if (!existing) {
          used.add(color)
          setColors(worktree, color)
        }
        if (!project.id) continue

        const requested = colorRequested.get(worktree)
        if (requested === color) continue
        colorRequested.set(worktree, color)

        if (project.id === "global") {
          globalSync.project.meta(worktree, { icon: { color } })
          continue
        }

        void globalSdk.client.project
          .update({ projectID: project.id, directory: worktree, icon: { color } })
          .catch(() => {
            if (colorRequested.get(worktree) === color) colorRequested.delete(worktree)
          })
      }
    })

    onMount(() => {
      Promise.all(
        server.projects.list().map((project) => {
          return globalSync.project.loadSessions(project.worktree)
        }),
      )
    })

    return {
      ready,
      handoff: {
        tabs: createMemo(() => store.handoff?.tabs),
        setTabs(dir: string, id: string) {
          setStore("handoff", "tabs", { dir: sessionDirKey(dir), id, at: Date.now() })
        },
        clearTabs() {
          if (!store.handoff?.tabs) return
          setStore("handoff", "tabs", undefined)
        },
      },
      projects: {
        list,
        open(directory: WorkspacePath) {
          const root = rootFor(directory)
          if (server.projects.list().some((x) => pathEqual(x.worktree, root))) return
          globalSync.project.loadSessions(root)
          server.projects.open(root)
        },
        close(directory: WorkspacePath) {
          server.projects.close(directory)
        },
        expand(directory: WorkspacePath) {
          server.projects.expand(directory)
        },
        collapse(directory: WorkspacePath) {
          server.projects.collapse(directory)
        },
        move(directory: WorkspacePath, toIndex: number) {
          server.projects.move(directory, toIndex)
        },
      },
      sidebar: {
        opened: createMemo(() => store.sidebar.opened),
        open() {
          setStore("sidebar", "opened", true)
        },
        close() {
          setStore("sidebar", "opened", false)
        },
        toggle() {
          setStore("sidebar", "opened", (x) => !x)
        },
        width: createMemo(() => store.sidebar.width),
        resize(width: number) {
          setStore("sidebar", "width", width)
        },
        workspaces(directory: WorkspacePath) {
          return () => store.sidebar.workspaces[workspacePathKey(directory)] ?? store.sidebar.workspacesDefault ?? false
        },
        setWorkspaces(directory: WorkspacePath, value: boolean) {
          setStore("sidebar", "workspaces", workspacePathKey(directory), value)
        },
        toggleWorkspaces(directory: WorkspacePath) {
          const key = workspacePathKey(directory)
          const current = store.sidebar.workspaces[key] ?? store.sidebar.workspacesDefault ?? false
          setStore("sidebar", "workspaces", key, !current)
        },
      },
      terminal: {
        height: createMemo(() => store.terminal.height),
        resize(height: number) {
          setStore("terminal", "height", height)
        },
      },
      review: {
        diffStyle: createMemo(() => store.review.diffStyle),
        setDiffStyle(diffStyle: ReviewDiffStyle) {
          setStore("review", "diffStyle", diffStyle)
        },
      },
      fileTree: {
        opened: createMemo(() => store.fileTree.opened),
        width: createMemo(() => store.fileTree.width),
        tab: createMemo(() => store.fileTree.tab),
        setTab(tab: "changes" | "all") {
          setStore("fileTree", "tab", tab)
        },
        open() {
          setStore("fileTree", "opened", true)
        },
        close() {
          setStore("fileTree", "opened", false)
        },
        toggle() {
          setStore("fileTree", "opened", (x) => !x)
        },
        resize(width: number) {
          setStore("fileTree", "width", width)
        },
      },
      session: {
        width: createMemo(() => store.session.width),
        resize(width: number) {
          setStore("session", "width", width)
        },
      },
      mobileSidebar: {
        opened: createMemo(() => store.mobileSidebar.opened),
        show() {
          setStore("mobileSidebar", "opened", true)
        },
        hide() {
          setStore("mobileSidebar", "opened", false)
        },
        toggle() {
          setStore("mobileSidebar", "opened", (x) => !x)
        },
      },
      pendingMessage: {
        set(sessionKey: string, messageID: string) {
          const key = normalizeSessionKey(sessionKey)
          const at = Date.now()
          touch(key)
          const current = store.sessionView[key]
          if (!current) {
            setStore("sessionView", key, {
              scroll: {},
              pendingMessage: messageID,
              pendingMessageAt: at,
            })
            prune(usage.active ?? key)
            return
          }

          setStore(
            "sessionView",
            key,
            produce((draft) => {
              draft.pendingMessage = messageID
              draft.pendingMessageAt = at
            }),
          )
        },
        consume(sessionKey: string) {
          const key = normalizeSessionKey(sessionKey)
          const current = store.sessionView[key]
          const message = current?.pendingMessage
          const at = current?.pendingMessageAt
          if (!message || !at) return

          setStore(
            "sessionView",
            key,
            produce((draft) => {
              delete draft.pendingMessage
              delete draft.pendingMessageAt
            }),
          )

          if (Date.now() - at > PENDING_MESSAGE_TTL_MS) return
          return message
        },
      },
      view(sessionKey: string | Accessor<string>) {
        const key = createSessionKeyReader(sessionKey, ensureKey)
        const s = createMemo(() => store.sessionView[key()] ?? { scroll: {} })
        const terminalOpened = createMemo(() => store.terminal.opened)
        const reviewPanelOpened = createMemo(() => store.review.panelOpened)

        function setTerminalOpened(next: boolean) {
          if (store.terminal.opened === next) return
          setStore("terminal", "opened", next)
        }

        function setReviewPanelOpened(next: boolean) {
          if (store.review.panelOpened === next) return
          setStore("review", "panelOpened", next)
        }

        return {
          scroll(tab: string) {
            return scroll.scroll(key(), tab)
          },
          setScroll(tab: string, pos: SessionScroll) {
            scroll.setScroll(key(), tab, pos)
          },
          terminal: {
            opened: terminalOpened,
            open() {
              setTerminalOpened(true)
            },
            close() {
              setTerminalOpened(false)
            },
            toggle() {
              setTerminalOpened(!terminalOpened())
            },
          },
          reviewPanel: {
            opened: reviewPanelOpened,
            open() {
              setReviewPanelOpened(true)
            },
            close() {
              setReviewPanelOpened(false)
            },
            toggle() {
              setReviewPanelOpened(!reviewPanelOpened())
            },
          },
          review: {
            open: createMemo(() => reviewPaths(s().reviewOpen ?? [])),
            setOpen(open: ReviewPath[]) {
              const session = key()
              const next = reviewPaths(open)
              const current = store.sessionView[session]
              if (!current) {
                setStore("sessionView", session, {
                  scroll: {},
                  reviewOpen: next,
                })
                return
              }

              if (sameReviewPaths(current.reviewOpen, next)) return
              setStore("sessionView", session, "reviewOpen", next)
            },
            openPath(path: ReviewPath) {
              const session = key()
              const current = store.sessionView[session]
              if (!current) {
                setStore("sessionView", session, {
                  scroll: {},
                  reviewOpen: [path],
                })
                return
              }

              if (!current.reviewOpen) {
                setStore("sessionView", session, "reviewOpen", [path])
                return
              }

              const index = current.reviewOpen.findIndex((item) => pathEqual(item, path))
              if (index !== -1) {
                if (current.reviewOpen[index] === path) return
                setStore("sessionView", session, "reviewOpen", index, path)
                return
              }

              setStore("sessionView", session, "reviewOpen", current.reviewOpen.length, path)
            },
            closePath(path: ReviewPath) {
              const session = key()
              const current = store.sessionView[session]?.reviewOpen
              if (!current) return

              const index = current.findIndex((item) => pathEqual(item, path))
              if (index === -1) return
              setStore(
                "sessionView",
                session,
                "reviewOpen",
                produce((draft) => {
                  if (!draft) return
                  draft.splice(index, 1)
                }),
              )
            },
            togglePath(path: ReviewPath) {
              const session = key()
              const current = store.sessionView[session]?.reviewOpen
              if (!current || !current.some((item) => pathEqual(item, path))) {
                this.openPath(path)
                return
              }

              this.closePath(path)
            },
          },
        }
      },
      tabs(sessionKey: string | Accessor<string>) {
        const key = createSessionKeyReader(sessionKey, ensureKey)
        const path = createMemo(() => sessionPathHelpers(key()))
        const tabs = createMemo(() => store.sessionTabs[key()] ?? { all: [] })
        const normalize = (tab: string) => normalizeSessionTab(path(), tab)
        const normalizeAll = (all: string[]) => normalizeSessionTabList(path(), all)
        return {
          tabs,
          active: createMemo(() => tabs().active),
          all: createMemo(() => tabs().all.filter((tab) => tab !== "review")),
          setActive(tab: string | undefined) {
            const session = key()
            const next = tab ? normalize(tab) : tab
            if (!store.sessionTabs[session]) {
              setStore("sessionTabs", session, { all: [], active: next })
            } else {
              setStore("sessionTabs", session, "active", next)
            }
          },
          setAll(all: string[]) {
            const session = key()
            const next = normalizeAll(all).filter((tab) => tab !== "review")
            if (!store.sessionTabs[session]) {
              setStore("sessionTabs", session, { all: next, active: undefined })
            } else {
              setStore("sessionTabs", session, "all", next)
            }
          },
          async open(tab: string) {
            const session = key()
            const next = nextSessionTabsForOpen(store.sessionTabs[session], normalize(tab))
            setStore("sessionTabs", session, next)
          },
          close(tab: string) {
            const session = key()
            const current = store.sessionTabs[session]
            if (!current) return

            if (tab === "review") {
              if (current.active !== tab) return
              setStore("sessionTabs", session, "active", current.all[0])
              return
            }

            const all = current.all.filter((x) => x !== tab)
            if (current.active !== tab) {
              setStore("sessionTabs", session, "all", all)
              return
            }

            const index = current.all.findIndex((f) => f === tab)
            const next = current.all[index - 1] ?? current.all[index + 1] ?? all[0]
            batch(() => {
              setStore("sessionTabs", session, "all", all)
              setStore("sessionTabs", session, "active", next)
            })
          },
          move(tab: string, to: number) {
            const session = key()
            const current = store.sessionTabs[session]
            if (!current) return
            const index = current.all.findIndex((f) => f === tab)
            if (index === -1) return
            setStore(
              "sessionTabs",
              session,
              "all",
              produce((opened) => {
                opened.splice(to, 0, opened.splice(index, 1)[0])
              }),
            )
          },
        }
      },
    }
  },
})
