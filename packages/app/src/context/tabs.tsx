import type { Session } from "@opencode-ai/sdk/v2/client"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { createStore, produce } from "solid-js/store"
import { Persist, persisted, removePersisted, draftPersistedKeys } from "@/utils/persist"
import { ServerConnection, useServer } from "./server"
import { batch, createEffect, startTransition } from "solid-js"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { usePlatform } from "./platform"
import { uuid } from "@/utils/uuid"
import { SessionTabsRemovedDetail } from "@/components/titlebar-session-events"
import type { LayoutRoute } from "./layout"

export type SessionTab = {
  type: "session"
  server: ServerConnection.Key
  dirBase64: string
  sessionId: string
}

export type DraftTab = {
  type: "draft"
  draftID: string
  server: ServerConnection.Key
  directory: string
  worktree?: string
}

export type Tab = SessionTab | DraftTab

export type SessionTabTarget = {
  server: ServerConnection.Key
  dirBase64: string
  sessionID: string
  rootSessionID: string
}

type ActiveState = {
  active?: string
}

export const draftHref = (draftID: string) => `/new-session?draftId=${encodeURIComponent(draftID)}`

export const tabHref = (tab: Tab) =>
  tab.type === "draft" ? draftHref(tab.draftID) : `/${tab.dirBase64}/session/${tab.sessionId}`

export const tabKey = (tab: Tab) => (tab.type === "draft" ? `draft:${tab.draftID}` : `${tab.server}\n${tabHref(tab)}`)

const sessionRouteKey = (server: ServerConnection.Key, dirBase64: string, sessionID: string) =>
  `${server}\n${dirBase64}\n${sessionID}`

export function sessionHasOpenTab(tabs: Tab[], server: ServerConnection.Key, session: Session) {
  const dirBase64 = base64Encode(session.directory)
  return tabs.some(
    (tab) =>
      tab.type === "session" && tab.server === server && tab.dirBase64 === dirBase64 && tab.sessionId === session.id,
  )
}

export const { use: useTabs, provider: TabsProvider } = createSimpleContext({
  name: "Tabs",
  gate: false,
  init: () => {
    const server = useServer()
    const platform = usePlatform()
    const defaultServer = server.key
    const [tabs, setTabs, , tabsReady] = persisted(
      {
        ...Persist.global("tabs"),
        migrate: (value: unknown) => {
          if (!Array.isArray(value)) return value
          return value.map((tab) => {
            if (!tab || typeof tab !== "object" || "server" in tab) return tab
            return { ...tab, server: defaultServer }
          })
        },
      },
      createStore<Tab[]>([]),
    )
    const [active, setActive, , activeReady] = persisted(Persist.global("tabs.active"), createStore<ActiveState>({}))
    const [sessionRoutes, setSessionRoutes] = createStore<Record<string, string>>({})
    const ready = () => tabsReady() && activeReady()

    const params = useParams()
    const navigate = useNavigate()
    const location = useLocation()

    const closing = new Set<string>()

    const removeDraftPersisted = (draftID: string) => {
      for (const key of draftPersistedKeys()) removePersisted(Persist.draft(draftID, key), platform)
    }

    const removeSessionRoutes = (tab: string) => {
      setSessionRoutes(
        produce((routes) => {
          for (const [route, target] of Object.entries(routes)) {
            if (target === tab) delete routes[route]
          }
        }),
      )
    }

    const pruneSessionRoutes = (tabs: Set<string>) => {
      setSessionRoutes(
        produce((routes) => {
          for (const [route, tab] of Object.entries(routes)) {
            if (!tabs.has(tab)) delete routes[route]
          }
        }),
      )
    }

    const removeSessionRouteIDs = (input: SessionTabsRemovedDetail) => {
      setSessionRoutes(
        produce((routes) => {
          for (const sessionID of input.sessionIDs) {
            delete routes[sessionRouteKey(server.key, base64Encode(input.directory), sessionID)]
          }
        }),
      )
    }

    createEffect(() => {
      if (!ready()) return
      const servers = new Set(server.list.map(ServerConnection.key))
      if (tabs.every((tab) => servers.has(tab.server))) return
      const next = tabs.filter((tab) => servers.has(tab.server))
      setTabs(() => next)
      if (active.active && !next.some((tab) => tabKey(tab) === active.active)) setActive("active", undefined)
      pruneSessionRoutes(new Set(next.map(tabKey)))
    })

    const navigateTab = (tab: Tab, href = tabHref(tab)) => {
      if (tab.server === server.key) {
        batch(() => {
          setActive("active", tabKey(tab))
          navigate(href)
        })
        return
      }
      void startTransition(() => {
        setActive("active", tabKey(tab))
        server.setActive(tab.server)
        navigate(href)
      })
    }

    const current = (route: LayoutRoute) => {
      if (route.type === "home" || route.type === "dir-new-sesssion") return
      if (route.type === "draft") {
        return tabs.find((tab) => tab.type === "draft" && tab.draftID === route.draftID)
      }
      const key = sessionRoutes[sessionRouteKey(route.server, route.dirBase64, route.sessionId)]
      if (key) return tabs.find((tab) => tabKey(tab) === key)
      return tabs.find(
        (tab) =>
          tab.type === "session" &&
          tab.server === route.server &&
          tab.dirBase64 === route.dirBase64 &&
          tab.sessionId === route.sessionId,
      )
    }

    const canToggleHome = (route: LayoutRoute) => {
      if (!ready()) return false
      if (route.type === "home") return true
      return current(route) !== undefined
    }

    const actions = {
      enterSession(input: SessionTabTarget) {
        const tab = {
          type: "session" as const,
          server: input.server,
          dirBase64: input.dirBase64,
          sessionId: input.rootSessionID,
        }
        const key = tabKey(tab)
        if (closing.has(key)) return
        batch(() => {
          if (!tabs.some((item) => tabKey(item) === key)) setTabs(tabs.length, tab)
          setActive("active", key)
          setSessionRoutes(sessionRouteKey(input.server, input.dirBase64, input.sessionID), key)
        })
      },
      draft(draftID: string) {
        const tab = tabs.find((item) => item.type === "draft" && item.draftID === draftID)
        if (!tab || tab.type !== "draft") throw new Error(`Draft not found: ${draftID}`)
        return tab
      },
      newDraft(draft: Omit<DraftTab, "type" | "draftID">, prompt?: string) {
        const draftID = uuid()
        const tab = { type: "draft" as const, draftID, ...draft }
        setTabs(tabs.length, tab)
        navigateTab(tab, prompt ? `${draftHref(draftID)}&prompt=${encodeURIComponent(prompt)}` : draftHref(draftID))
      },
      updateDraft(draftID: string, draft: Partial<Omit<DraftTab, "type" | "draftID">>) {
        setTabs(
          (tab) => tab.type === "draft" && tab.draftID === draftID,
          produce((tab) => Object.assign(tab, draft)),
        )
      },
      promoteDraft(draftID: string, session: Omit<SessionTab, "type">) {
        // We're viewing this draft when /new-session?draftId=… points at it. Promoting
        // replaces the draft tab with a session tab, so the draft route would stop resolving
        // and fall back home. Navigate to the new session first so we leave /new-session
        // before the draft is removed from the store.
        const viewing = location.pathname === "/new-session" && location.query.draftId === draftID
        startTransition(() => {
          batch(() => {
            setTabs(
              produce((tabs) => {
                const index = tabs.findIndex((tab) => tab.type === "draft" && tab.draftID === draftID)
                if (index === -1) return
                tabs[index] = { type: "session", ...session }
              }),
            )
            const previous = `draft:${draftID}`
            const next = tabKey({ type: "session", ...session })
            if (active.active === previous) setActive("active", next)
          })
          if (viewing) navigateTab({ type: "session", ...session })
        })
        removeDraftPersisted(draftID)
      },
      removeTab: (index: number) => {
        const tab = tabs[index]
        if (!tab) return
        const key = tabKey(tab)
        const draftID = tab.type === "draft" ? tab.draftID : undefined
        const nextTab = tabs[index + 1] ?? tabs[index - 1]
        closing.add(key)
        void startTransition(() => {
          setTabs(produce((tabs) => void tabs.splice(index, 1)))
          if (active.active === key) setActive("active", nextTab && tabKey(nextTab))
          removeSessionRoutes(key)
          if (nextTab) navigateTab(nextTab)
          else navigate("/")
        }).finally(() => closing.delete(key))
        if (draftID) removeDraftPersisted(draftID)
      },
      removeServer(key: ServerConnection.Key) {
        const drafts = tabs.flatMap((tab) => (tab.type === "draft" && tab.server === key ? [tab.draftID] : []))
        const next = tabs.filter((tab) => tab.server !== key)
        setTabs(() => next)
        if (active.active && !next.some((tab) => tabKey(tab) === active.active)) setActive("active", undefined)
        pruneSessionRoutes(new Set(next.map(tabKey)))
        for (const draftID of drafts) removeDraftPersisted(draftID)
        if (server.key === key) navigate("/")
      },
      removeSessions: (input: SessionTabsRemovedDetail) => {
        const sessionIDs = new Set(input.sessionIDs)
        const currentKey =
          params.dir && params.id
            ? (sessionRoutes[sessionRouteKey(server.key, params.dir, params.id)] ??
              tabKey({ type: "session", server: server.key, dirBase64: params.dir, sessionId: params.id }))
            : undefined
        removeSessionRouteIDs(input)
        const currentIndex = currentKey ? tabs.findIndex((tab) => tabKey(tab) === currentKey) : -1
        const removed = tabs.filter(
          (tab) =>
            tab.type === "session" &&
            tab.server === server.key &&
            atob(tab.dirBase64) === input.directory &&
            sessionIDs.has(tab.sessionId),
        )
        if (removed.length === 0) return

        const removedKeys = new Set(removed.map(tabKey))
        const next = tabs.filter((tab) => !removedKeys.has(tabKey(tab)))
        const removedCurrent = !!currentKey && removedKeys.has(currentKey)
        const nextTab = removedCurrent
          ? (tabs.slice(currentIndex + 1).find((tab) => !removedKeys.has(tabKey(tab))) ??
            tabs.slice(0, currentIndex).findLast((tab) => !removedKeys.has(tabKey(tab))))
          : undefined

        void startTransition(() => {
          batch(() => {
            setTabs(() => next)
            if (active.active && removedKeys.has(active.active))
              setActive("active", nextTab ? tabKey(nextTab) : undefined)
            pruneSessionRoutes(new Set(next.map(tabKey)))
          })
          if (nextTab) navigateTab(nextTab)
          if (removedCurrent && !nextTab) navigate("/")
        })
      },
      canToggleHome,
      current,
      select: navigateTab,
      toggleHome(route: LayoutRoute) {
        if (!canToggleHome(route)) return
        if (route.type === "home") {
          const tab = tabs.find((tab) => tabKey(tab) === active.active)
          if (tab) navigateTab(tab)
          return
        }
        const tab = current(route)
        if (tab) setActive("active", tabKey(tab))
        navigate("/")
      },
    }

    return {
      ...actions,
      get store() {
        return tabs
      },
      ready,
    }
  },
})
