import { createSimpleContext } from "@opencode-ai/ui/context"
import { createStore, produce } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { ServerConnection, useServer } from "./server"
import { startTransition } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { SessionTabsRemovedDetail } from "@/components/titlebar-session-events"

export type SessionTab = {
  type: "session"
  server: ServerConnection.Key
  dirBase64: string
  sessionId: string
}

export type Tab = SessionTab

export const tabHref = (tab: Tab) => `/${tab.dirBase64}/session/${tab.sessionId}`
export const tabKey = (tab: Tab) => `${tab.server}\n${tabHref(tab)}`

const makeSessionHref = (b64Dir: string, sessionId: string) => `/${b64Dir}/session/${sessionId}`

export const { use: useTabs, provider: TabsProvider } = createSimpleContext({
  name: "Tabs",
  gate: false,
  init: () => {
    const [store, setStore, _, ready] = persisted(Persist.global("tabs"), createStore<Tab[]>([]))

    const params = useParams()
    const server = useServer()
    const navigate = useNavigate()

    const closing = new Set<string>()

    const navigateTab = (tab: Tab) => {
      const href = tabHref(tab)
      if (tab.server === server.key) {
        navigate(href)
        return
      }
      void startTransition(() => {
        server.setActive(tab.server)
        navigate(href)
      })
    }

    const actions = {
      addSessionTab: (tab: Omit<SessionTab, "type">) => {
        setStore(
          produce((tabs) => {
            if (tabs.some((item) => tabKey(item) === tabKey({ type: "session", ...tab }))) return

            tabs.push({ type: "session", ...tab })
          }),
        )
      },
      removeTab: (index: number) => {
        const tab = store[index]
        if (!tab) return
        const key = tabKey(tab)
        const nextTab = store[index + 1] ?? store[index - 1]
        closing.add(key)
        void startTransition(() => {
          setStore(
            produce((tabs) => {
              tabs.splice(index, 1)
            }),
          )
          if (nextTab) navigateTab(nextTab)
          else navigate("/")
        }).finally(() => closing.delete(key))
      },
      removeSessions: (input: SessionTabsRemovedDetail) => {
        void startTransition(() => {
          setStore(
            produce((tabs) => {
              const sessionIDs = new Set(input.sessionIDs)
              const currentHref = params.dir && params.id ? makeSessionHref(params.dir, params.id) : undefined
              const currentIndex = currentHref
                ? tabs.findIndex(
                    (tab) => tab.type === "session" && tab.server === server.key && tabHref(tab) === currentHref,
                  )
                : -1
              const currentTab = tabs[currentIndex]
              const removedCurrent =
                currentTab?.type === "session" &&
                currentTab.server === server.key &&
                atob(currentTab.dirBase64) === input.directory &&
                sessionIDs.has(currentTab.sessionId)

              for (let i = tabs.length - 1; i >= 0; i--) {
                const tab = tabs[i]
                if (!tab || tab.type !== "session") continue
                if (tab.server !== server.key) continue
                if (atob(tab.dirBase64) !== input.directory) continue
                if (!sessionIDs.has(tab.sessionId)) continue
                tabs.splice(i, 1)
              }

              if (!removedCurrent) return
              const nextTab =
                tabs.slice(currentIndex).find((tab) => tab.type === "session") ??
                tabs.slice(0, currentIndex).findLast((tab) => tab.type === "session")
              if (nextTab) navigateTab(nextTab)
              else navigate("/")
            }),
          )
        })
      },
    }

    return { ...actions, store, ready }
  },
})
