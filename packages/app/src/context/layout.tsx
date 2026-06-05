import { createStore, produce } from "solid-js/store"
import { batch, createEffect, createMemo, createRoot, getOwner, onCleanup, onMount, type Accessor } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useServerContext, useServerSDK, useServerSync } from "./server-context"
import { ServerConnection } from "./server"
import { usePlatform } from "./platform"
import { Project } from "@opencode-ai/sdk/v2"
import { Persist, persisted, removePersisted } from "@/utils/persist"
import { decode64 } from "@/utils/base64"
import { same } from "@/utils/same"
import { createScrollPersistence, type SessionScroll } from "./layout-scroll"
import { createPathHelpers } from "./file/path"
import type { ProjectAvatarVariant } from "@opencode-ai/ui/v2/project-avatar-v2"
import { migrateLegacySessionStateKeys, ServerScope, SessionStateKey } from "@/utils/server-scope"
import { createScopedCache } from "@/utils/scoped-cache"
import { createSessionKeyReader, ensureSessionKey, pruneSessionKeys } from "./layout-helpers"
import { DirectoryState, type DirectoryStateScope } from "./directory"

export { createSessionKeyReader, ensureSessionKey, pruneSessionKeys }

export type { ProjectAvatarVariant }

const AVATAR_COLOR_KEYS = ["pink", "mint", "orange", "purple", "cyan", "lime"] as const
const DEFAULT_SIDEBAR_WIDTH = 344
const DEFAULT_FILE_TREE_WIDTH = 200
const DEFAULT_SESSION_WIDTH = 600
const DEFAULT_TERMINAL_HEIGHT = 280
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

export function getProjectAvatarVariant(key?: string): ProjectAvatarVariant {
  if (key === "orange") return "orange"
  if (key === "pink") return "pink"
  if (key === "cyan") return "cyan"
  if (key === "purple") return "purple"
  if (key === "mint") return "cyan"
  if (key === "lime") return "green"
  return "gray"
}

type SessionTabs = {
  active?: string
  all: string[]
}

type SessionView = {
  scroll: Record<string, SessionScroll>
  reviewOpen?: string[]
  pendingMessage?: string
  pendingMessageAt?: number
  todoCollapsed?: boolean
}

export type LocalProject = Partial<Project> & { worktree: string; expanded: boolean }

export type ReviewDiffStyle = "unified" | "split"

function nextSessionTabsForOpen(current: SessionTabs | undefined, tab: string): SessionTabs {
  const all = current?.all ?? []
  if (tab === "review") return { all: all.filter((x) => x !== "review"), active: tab }
  if (tab === "context") return { all: [tab, ...all.filter((x) => x !== tab)], active: tab }
  if (!all.includes(tab)) return { all: [...all, tab], active: tab }
  return { all, active: tab }
}

const sessionPath = (key: string) => {
  if (DirectoryState.draftID(key)) return
  const dir = SessionStateKey.route(key).split("/")[0]
  if (!dir) return
  const root = decode64(dir)
  if (!root) return
  return createPathHelpers(() => root)
}

const normalizeSessionTab = (path: ReturnType<typeof createPathHelpers> | undefined, tab: string) => {
  if (!tab.startsWith("file://")) return tab
  if (!path) return tab
  return path.tab(tab)
}

const normalizeSessionTabList = (path: ReturnType<typeof createPathHelpers> | undefined, all: string[]) => {
  const seen = new Set<string>()
  return all.flatMap((tab) => {
    const value = normalizeSessionTab(path, tab)
    if (seen.has(value)) return []
    seen.add(value)
    return [value]
  })
}

const normalizeStoredSessionTabs = (key: string, tabs: SessionTabs) => {
  const path = sessionPath(key)
  return {
    all: normalizeSessionTabList(path, tabs.all),
    active: tabs.active ? normalizeSessionTab(path, tabs.active) : tabs.active,
  }
}

export const { use: useLayout, provider: LayoutProvider } = createSimpleContext({
  name: "Layout",
  gate: false,
  init: () => {
    const serverSdk = useServerSDK()
    const serverSync = useServerSync()
    const server = useServerContext()
    const platform = usePlatform()

    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value)

    const migrate = (value: unknown) => {
      if (!isRecord(value)) return value

      const sidebar = value.sidebar
      const migratedSidebar = (() => {
        if (!isRecord(sidebar)) return sidebar
        if (typeof sidebar.workspaces !== "boolean") return sidebar
        return {
          ...sidebar,
          workspaces: {},
          workspacesDefault: sidebar.workspaces,
        }
      })()

      const review = value.review
      const fileTree = value.fileTree
      const migratedFileTree = (() => {
        if (!isRecord(fileTree)) return fileTree
        if (fileTree.tab === "changes" || fileTree.tab === "all") return fileTree

        const width = typeof fileTree.width === "number" ? fileTree.width : DEFAULT_FILE_TREE_WIDTH
        return {
          ...fileTree,
          opened: true,
          width: width === 260 ? DEFAULT_FILE_TREE_WIDTH : width,
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

      const sessionTabs = migrateLegacySessionStateKeys(value.sessionTabs)
      const sessionView = migrateLegacySessionStateKeys(value.sessionView)
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

      if (
        migratedSidebar === sidebar &&
        migratedReview === review &&
        migratedFileTree === fileTree &&
        migratedSessionTabs === value.sessionTabs &&
        sessionView === value.sessionView
      ) {
        return value
      }

      return {
        ...value,
        sidebar: migratedSidebar,
        review: migratedReview,
        fileTree: migratedFileTree,
        sessionTabs: migratedSessionTabs,
        sessionView,
      }
    }

    const MAX_SESSION_KEYS = 50
    const PENDING_MESSAGE_TTL_MS = 2 * 60 * 1000
    const SESSION_STATE_KEYS = [
      { key: "prompt", legacy: "prompt", version: "v2" },
      { key: "terminal", legacy: "terminal", version: "v1" },
      { key: "file-view", legacy: "file", version: "v1" },
    ] as const
    const createState = (scope: ServerScope, target = Persist.serverGlobal(scope, "layout", ["layout.v6"])) => {
      const [store, setStore, _, ready] = persisted(
        { ...target, migrate },
        createStore({
          sidebar: {
            opened: false,
            width: DEFAULT_SIDEBAR_WIDTH,
            workspaces: {} as Record<string, boolean>,
            workspacesDefault: false,
          },
          terminal: { height: DEFAULT_TERMINAL_HEIGHT, opened: false },
          review: { diffStyle: "split" as ReviewDiffStyle, panelOpened: true },
          fileTree: { opened: false, width: DEFAULT_FILE_TREE_WIDTH, tab: "changes" as "changes" | "all" },
          session: { width: DEFAULT_SESSION_WIDTH },
          mobileSidebar: { opened: false },
          sessionTabs: {} as Record<string, SessionTabs>,
          sessionView: {} as Record<string, SessionView>,
        }),
      )
      const usage = { active: undefined as string | undefined, pruned: false, used: new Map<string, number>() }

      const dropSessionState = (keys: string[]) => {
        for (const key of keys) {
          const scope = SessionStateKey.scope(key)
          const parts = SessionStateKey.route(key).split("/")
          const dir = parts[0]
          const session = parts[1]
          if (!dir) continue
          for (const entry of SESSION_STATE_KEYS) {
            const target = session
              ? Persist.serverSession(scope, dir, session, entry.key)
              : Persist.serverWorkspace(scope, dir, entry.key)
            void removePersisted(target, platform)
            if (scope !== ServerScope.local) continue
            void removePersisted({ key: `${dir}/${entry.legacy}${session ? "/" + session : ""}.${entry.version}` }, platform)
          }
        }
      }

      const scroll = createScrollPersistence({
        debounceMs: 250,
        getSnapshot: (sessionKey) => store.sessionView[sessionKey]?.scroll,
        onFlush: (sessionKey, next) => {
          const current = store.sessionView[sessionKey]
          const keep = usage.active ?? sessionKey
          if (!current) setStore("sessionView", sessionKey, { scroll: next })
          if (current) setStore("sessionView", sessionKey, "scroll", (prev) => ({ ...prev, ...next }))
          prune(keep)
        },
      })

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
        for (const key of drop) usage.used.delete(key)
      }

      function touch(sessionKey: string) {
        usage.active = sessionKey
        usage.used.set(sessionKey, Date.now())
        if (!ready() || usage.pruned) return
        usage.pruned = true
        prune(sessionKey)
      }

      void Promise.resolve(ready.promise).then(() => {
        if (usage.pruned || !usage.active) return
        usage.pruned = true
        prune(usage.active)
      })

      onMount(() => {
        const flush = () => batch(() => scroll.flushAll())
        makeEventListener(window, "pagehide", flush)
        makeEventListener(document, "visibilitychange", () => {
          if (document.visibilityState === "hidden") flush()
        })
        onCleanup(() => scroll.dispose())
      })

      const [colors, setColors] = createStore<Record<string, AvatarColorKey>>({})
      return {
        store,
        setStore,
        ready,
        usage,
        scroll,
        prune,
        touch,
        ensureKey: (key: string) => ensureSessionKey(key, touch, (sessionKey) => scroll.seed(sessionKey)),
        colors,
        setColors,
        colorRequested: new Map<string, AvatarColorKey>(),
      }
    }

    const owner = getOwner()
    const cache = createScopedCache(
      (scope: ServerScope) => createRoot((dispose) => ({ value: createState(scope), dispose }), owner),
      { dispose: (entry) => entry.dispose() },
    )
    const draftCache = createScopedCache(
      (draftID: string) =>
        createRoot((dispose) => ({ value: createState(ServerScope.local, Persist.draft(draftID, "layout")), dispose }), owner),
      { dispose: (entry) => entry.dispose() },
    )
    onCleanup(() => cache.clear())
    onCleanup(() => draftCache.clear())
    const state = createMemo(() => cache.get(server().scope).value)
    const stateForKey = (key: string) => {
      const draftID = DirectoryState.draftID(key)
      if (draftID) return draftCache.get(draftID).value
      return cache.get(SessionStateKey.scope(key)).value
    }

    function pickAvailableColor(used: Set<string>): AvatarColorKey {
      const available = AVATAR_COLOR_KEYS.filter((c) => !used.has(c))
      if (available.length === 0) return AVATAR_COLOR_KEYS[Math.floor(Math.random() * AVATAR_COLOR_KEYS.length)]
      return available[Math.floor(Math.random() * available.length)]
    }

    function enrich(project: { worktree: string; expanded: boolean }) {
      const sync = serverSync()
      const [childStore] = sync.child(project.worktree, { bootstrap: false })
      const projectID = childStore.project
      const metadata = projectID
        ? sync.data.project.find((x) => x.id === projectID)
        : sync.data.project.find((x) => x.worktree === project.worktree)

      // Preserve local icon override from per-workspace localStorage cache (childStore.icon).
      // Without this, different subdirectories of the same git repo would share the same
      // icon from the database instead of using their individual overrides.
      const base = { ...metadata, ...project }
      if (childStore.icon) {
        return { ...base, icon: { ...base.icon, override: childStore.icon } }
      }
      return base
    }

    const roots = createMemo(() => {
      const map = new Map<string, string>()
      for (const project of serverSync().data.project) {
        const sandboxes = project.sandboxes ?? []
        for (const sandbox of sandboxes) {
          map.set(sandbox, project.worktree)
        }
      }
      return map
    })

    const rootFor = (directory: string) => {
      const map = roots()
      if (map.size === 0) return directory

      const visited = new Set<string>()
      const chain = [directory]

      while (chain.length) {
        const current = chain[chain.length - 1]
        if (!current) return directory

        const next = map.get(current)
        if (!next) return current

        if (visited.has(next)) return directory
        visited.add(next)
        chain.push(next)
      }

      return directory
    }

    createEffect(() => {
      const projects = server().projects.list()
      const seen = new Set(projects.map((project) => project.worktree))

      batch(() => {
        for (const project of projects) {
          const root = rootFor(project.worktree)
          if (root === project.worktree) continue

          server().projects.close(project.worktree)

          if (!seen.has(root)) {
            server().projects.open(root)
            seen.add(root)
          }

          if (project.expanded) server().projects.expand(root)
        }
      })
    })

    const enriched = createMemo(() => server().projects.list().map(enrich))
    const list = createMemo(() => {
      const projects = enriched()
      return projects.map((project) => {
        const color = project.icon?.color ?? state().colors[project.worktree]
        if (!color) return project
        const icon = project.icon ? { ...project.icon, color } : { color }
        return { ...project, icon }
      })
    })

    createEffect(() => {
      const projects = enriched()
      if (projects.length === 0) return
      const sync = serverSync()
      if (!sync.ready) return

      for (const project of projects) {
        if (!project.id) continue
        if (project.id === "global") continue
        sync.project.icon(project.worktree, project.icon?.override)
      }
    })

    createEffect(() => {
      const projects = enriched()
      if (projects.length === 0) return
      const sync = serverSync()
      const sdk = serverSdk()
      const layout = state()

      for (const project of projects) {
        if (project.icon?.color) layout.colorRequested.delete(project.worktree)
      }

      const used = new Set<string>()
      for (const project of projects) {
        const color = project.icon?.color ?? layout.colors[project.worktree]
        if (color) used.add(color)
      }

      for (const project of projects) {
        if (project.icon?.color || project.icon?.override || project.icon?.url) continue
        const worktree = project.worktree
        const existing = layout.colors[worktree]
        const color = existing ?? pickAvailableColor(used)
        if (!existing) {
          used.add(color)
          layout.setColors(worktree, color)
        }
        if (!project.id) continue

        const requested = layout.colorRequested.get(worktree)
        if (requested === color) continue
        layout.colorRequested.set(worktree, color)

        if (project.id === "global") {
          sync.project.meta(worktree, { icon: { color } })
          continue
        }

        void sdk.client.project
          .update({ projectID: project.id, directory: worktree, icon: { color } })
          .catch(() => {
            if (layout.colorRequested.get(worktree) === color) layout.colorRequested.delete(worktree)
          })
      }
    })

    let sessionFrame: number | undefined
    let sessionTimer: number | undefined

    onMount(() => {
      sessionFrame = requestAnimationFrame(() => {
        sessionFrame = undefined
        sessionTimer = window.setTimeout(() => {
          sessionTimer = undefined
          const current = server()
          void Promise.all(
            current.projects.list().map((project) => {
              return current.sync.project.loadSessions(project.worktree)
            }),
          )
        }, 0)
      })
    })

    onCleanup(() => {
      if (sessionFrame !== undefined) cancelAnimationFrame(sessionFrame)
      if (sessionTimer !== undefined) window.clearTimeout(sessionTimer)
    })

    return {
      ready: () => state().ready(),
      readyPromise: () => state().ready.promise,
      promoteTabs(from: DirectoryStateScope, to: DirectoryStateScope) {
        const fromKey = DirectoryState.layoutKey(from)
        const toKey = DirectoryState.layoutKey(to)
        const source = stateForKey(fromKey)
        const destination = stateForKey(toKey)
        const tabs = source.store.sessionTabs[fromKey]
        if (tabs) destination.setStore("sessionTabs", toKey, tabs)
        source.setStore(
          "sessionTabs",
          produce((draft) => {
            delete draft[fromKey]
          }),
        )
        if (from.state.type !== "draft") return
        draftCache.delete(from.state.id)
      },
      projects: {
        list,
        open(directory: string) {
          const root = rootFor(directory)
          if (server().projects.list().find((x) => x.worktree === root)) return
          void serverSync().project.loadSessions(root)
          server().projects.open(root)
        },
        close(directory: string) {
          server().projects.close(directory)
        },
        expand(directory: string) {
          server().projects.expand(directory)
        },
        collapse(directory: string) {
          server().projects.collapse(directory)
        },
        move(directory: string, toIndex: number) {
          server().projects.move(directory, toIndex)
        },
      },
      sidebar: {
        opened: createMemo(() => state().store.sidebar.opened),
        open() {
          state().setStore("sidebar", "opened", true)
        },
        close() {
          state().setStore("sidebar", "opened", false)
        },
        toggle() {
          state().setStore("sidebar", "opened", (x) => !x)
        },
        width: createMemo(() => state().store.sidebar.width),
        resize(width: number) {
          state().setStore("sidebar", "width", width)
        },
        workspaces(directory: string) {
          return () => state().store.sidebar.workspaces[directory] ?? state().store.sidebar.workspacesDefault ?? false
        },
        setWorkspaces(directory: string, value: boolean) {
          state().setStore("sidebar", "workspaces", directory, value)
        },
        toggleWorkspaces(directory: string) {
          const layout = state()
          const current = layout.store.sidebar.workspaces[directory] ?? layout.store.sidebar.workspacesDefault ?? false
          layout.setStore("sidebar", "workspaces", directory, !current)
        },
      },
      terminal: {
        height: createMemo(() => state().store.terminal.height),
        resize(height: number) {
          state().setStore("terminal", "height", height)
        },
      },
      review: {
        diffStyle: createMemo(() => state().store.review?.diffStyle ?? "split"),
        setDiffStyle(diffStyle: ReviewDiffStyle) {
          const layout = state()
          if (!layout.store.review) {
            layout.setStore("review", { diffStyle, panelOpened: true })
            return
          }
          layout.setStore("review", "diffStyle", diffStyle)
        },
      },
      fileTree: {
        opened: createMemo(() => state().store.fileTree?.opened ?? true),
        width: createMemo(() => state().store.fileTree?.width ?? DEFAULT_FILE_TREE_WIDTH),
        tab: createMemo(() => state().store.fileTree?.tab ?? "changes"),
        setTab(tab: "changes" | "all") {
          const layout = state()
          if (!layout.store.fileTree) {
            layout.setStore("fileTree", { opened: true, width: DEFAULT_FILE_TREE_WIDTH, tab })
            return
          }
          layout.setStore("fileTree", "tab", tab)
        },
        open() {
          const layout = state()
          if (!layout.store.fileTree) {
            layout.setStore("fileTree", { opened: true, width: DEFAULT_FILE_TREE_WIDTH, tab: "changes" })
            return
          }
          layout.setStore("fileTree", "opened", true)
        },
        close() {
          const layout = state()
          if (!layout.store.fileTree) {
            layout.setStore("fileTree", { opened: false, width: DEFAULT_FILE_TREE_WIDTH, tab: "changes" })
            return
          }
          layout.setStore("fileTree", "opened", false)
        },
        toggle() {
          const layout = state()
          if (!layout.store.fileTree) {
            layout.setStore("fileTree", { opened: true, width: DEFAULT_FILE_TREE_WIDTH, tab: "changes" })
            return
          }
          layout.setStore("fileTree", "opened", (x) => !x)
        },
        resize(width: number) {
          const layout = state()
          if (!layout.store.fileTree) {
            layout.setStore("fileTree", { opened: true, width, tab: "changes" })
            return
          }
          layout.setStore("fileTree", "width", width)
        },
      },
      session: {
        width: createMemo(() => state().store.session?.width ?? DEFAULT_SESSION_WIDTH),
        resize(width: number) {
          const layout = state()
          if (!layout.store.session) {
            layout.setStore("session", { width })
            return
          }
          layout.setStore("session", "width", width)
        },
      },
      mobileSidebar: {
        opened: createMemo(() => state().store.mobileSidebar?.opened ?? false),
        show() {
          state().setStore("mobileSidebar", "opened", true)
        },
        hide() {
          state().setStore("mobileSidebar", "opened", false)
        },
        toggle() {
          state().setStore("mobileSidebar", "opened", (x) => !x)
        },
      },
      pendingMessage: {
        set(sessionKey: string, messageID: string) {
          const layout = stateForKey(sessionKey)
          const at = Date.now()
          layout.touch(sessionKey)
          const current = layout.store.sessionView[sessionKey]
          if (!current) {
            layout.setStore("sessionView", sessionKey, {
              scroll: {},
              pendingMessage: messageID,
              pendingMessageAt: at,
            })
            layout.prune(layout.usage.active ?? sessionKey)
            return
          }

          layout.setStore(
            "sessionView",
            sessionKey,
            produce((draft) => {
              draft.pendingMessage = messageID
              draft.pendingMessageAt = at
            }),
          )
        },
        consume(sessionKey: string) {
          const layout = stateForKey(sessionKey)
          const current = layout.store.sessionView[sessionKey]
          const message = current?.pendingMessage
          const at = current?.pendingMessageAt
          if (!message || !at) return

          layout.setStore(
            "sessionView",
            sessionKey,
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
        const key = createSessionKeyReader(sessionKey, (value) => stateForKey(value).ensureKey(value))
        const s = createMemo(() => stateForKey(key()).store.sessionView[key()] ?? { scroll: {} })
        const terminalOpened = createMemo(() => stateForKey(key()).store.terminal?.opened ?? false)
        const reviewPanelOpened = createMemo(() => stateForKey(key()).store.review?.panelOpened ?? true)

        function setTerminalOpened(next: boolean) {
          const layout = stateForKey(key())
          const current = layout.store.terminal
          if (!current) {
            layout.setStore("terminal", { height: DEFAULT_TERMINAL_HEIGHT, opened: next })
            return
          }

          const value = current.opened ?? false
          if (value === next) return
          layout.setStore("terminal", "opened", next)
        }

        function setReviewPanelOpened(next: boolean) {
          const layout = stateForKey(key())
          const current = layout.store.review
          if (!current) {
            layout.setStore("review", { diffStyle: "split" as ReviewDiffStyle, panelOpened: next })
            return
          }

          const value = current.panelOpened ?? true
          if (value === next) return
          layout.setStore("review", "panelOpened", next)
        }

        return {
          scroll(tab: string) {
            return stateForKey(key()).scroll.scroll(key(), tab)
          },
          setScroll(tab: string, pos: SessionScroll) {
            stateForKey(key()).scroll.setScroll(key(), tab, pos)
          },
          todoCollapsed: {
            get: () => s().todoCollapsed ?? false,
            set(collapsed: boolean) {
              const session = key()
              const layout = stateForKey(session)
              const current = layout.store.sessionView[session]
              if (!current) {
                layout.setStore("sessionView", session, { scroll: {}, todoCollapsed: collapsed })
              } else {
                layout.setStore("sessionView", session, "todoCollapsed", collapsed)
              }
            },
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
            open: createMemo(() => s().reviewOpen ?? []),
            setOpen(open: string[]) {
              const session = key()
              const next = Array.from(new Set(open))
              const layout = stateForKey(session)
              const current = layout.store.sessionView[session]
              if (!current) {
                layout.setStore("sessionView", session, {
                  scroll: {},
                  reviewOpen: next,
                })
                return
              }

              if (same(current.reviewOpen, next)) return
              layout.setStore("sessionView", session, "reviewOpen", next)
            },
            openPath(path: string) {
              const session = key()
              const layout = stateForKey(session)
              const current = layout.store.sessionView[session]
              if (!current) {
                layout.setStore("sessionView", session, {
                  scroll: {},
                  reviewOpen: [path],
                })
                return
              }

              if (!current.reviewOpen) {
                layout.setStore("sessionView", session, "reviewOpen", [path])
                return
              }

              if (current.reviewOpen.includes(path)) return
              layout.setStore("sessionView", session, "reviewOpen", current.reviewOpen.length, path)
            },
            closePath(path: string) {
              const session = key()
              const layout = stateForKey(session)
              const current = layout.store.sessionView[session]?.reviewOpen
              if (!current) return

              const index = current.indexOf(path)
              if (index === -1) return
              layout.setStore(
                "sessionView",
                session,
                "reviewOpen",
                produce((draft) => {
                  if (!draft) return
                  draft.splice(index, 1)
                }),
              )
            },
            togglePath(path: string) {
              const session = key()
              const current = stateForKey(session).store.sessionView[session]?.reviewOpen
              if (!current || !current.includes(path)) {
                this.openPath(path)
                return
              }

              this.closePath(path)
            },
          },
        }
      },
      tabs(sessionKey: string | Accessor<string>) {
        const key = createSessionKeyReader(sessionKey, (value) => stateForKey(value).ensureKey(value))
        const path = createMemo(() => sessionPath(key()))
        const tabs = createMemo(() => stateForKey(key()).store.sessionTabs[key()] ?? { all: [] })
        const normalize = (tab: string) => normalizeSessionTab(path(), tab)
        const normalizeAll = (all: string[]) => normalizeSessionTabList(path(), all)
        return {
          tabs,
          active: createMemo(() => tabs().active),
          all: createMemo(() => tabs().all.filter((tab) => tab !== "review")),
          setActive(tab: string | undefined) {
            const session = key()
            const next = tab ? normalize(tab) : tab
            const layout = stateForKey(session)
            if (!layout.store.sessionTabs[session]) {
              layout.setStore("sessionTabs", session, { all: [], active: next })
            } else {
              layout.setStore("sessionTabs", session, "active", next)
            }
          },
          setAll(all: string[]) {
            const session = key()
            const next = normalizeAll(all).filter((tab) => tab !== "review")
            const layout = stateForKey(session)
            if (!layout.store.sessionTabs[session]) {
              layout.setStore("sessionTabs", session, { all: next, active: undefined })
            } else {
              layout.setStore("sessionTabs", session, "all", next)
            }
          },
          async open(tab: string) {
            const session = key()
            const layout = stateForKey(session)
            const next = nextSessionTabsForOpen(layout.store.sessionTabs[session], normalize(tab))
            layout.setStore("sessionTabs", session, next)
          },
          close(tab: string) {
            const session = key()
            const layout = stateForKey(session)
            const current = layout.store.sessionTabs[session]
            if (!current) return

            if (tab === "review") {
              if (current.active !== tab) return
              layout.setStore("sessionTabs", session, "active", current.all[0])
              return
            }

            const all = current.all.filter((x) => x !== tab)
            if (current.active !== tab) {
              layout.setStore("sessionTabs", session, "all", all)
              return
            }

            const index = current.all.findIndex((f) => f === tab)
            const next = current.all[index - 1] ?? current.all[index + 1] ?? all[0]
            batch(() => {
              layout.setStore("sessionTabs", session, "all", all)
              layout.setStore("sessionTabs", session, "active", next)
            })
          },
          move(tab: string, to: number) {
            const session = key()
            const layout = stateForKey(session)
            const current = layout.store.sessionTabs[session]
            if (!current) return
            const index = current.all.findIndex((f) => f === tab)
            if (index === -1) return
            layout.setStore(
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
