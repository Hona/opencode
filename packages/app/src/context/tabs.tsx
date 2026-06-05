import { createSimpleContext } from "@opencode-ai/ui/context"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { ServerConnection, useServer } from "./server"

export type SessionTab = {
  type: "session"
  server: ServerConnection.Key
  dirBase64: string
  sessionId: string
}

export type Tab = SessionTab

export const tabHref = (tab: Tab) => `/${tab.dirBase64}/session/${tab.sessionId}`
export const tabKey = (tab: Tab) => `${tab.server}\n${tabHref(tab)}`

export const { use: useTabs, provider: TabsProvider } = createSimpleContext({
  name: "Tabs",
  gate: false,
  init: () => {
    const server = useServer()
    const fallback = server.key
    const target = {
      ...Persist.global("tabs"),
      migrate: (value: unknown) => {
        if (!Array.isArray(value)) return value
        return value.map((tab) => {
          if (!tab || typeof tab !== "object" || "server" in tab) return tab
          return { ...tab, server: fallback }
        })
      },
    }
    const [store, setStore, _, ready] = persisted(target, createStore<Tab[]>([]))
    return { store, setStore, ready }
  },
})
