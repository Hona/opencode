import { createSimpleContext } from "@opencode-ai/ui/context"
import { createStore, produce } from "solid-js/store"
import { batch } from "solid-js"
import { Persist, persisted } from "@/utils/persist"
import { useLocation, useNavigate } from "@solidjs/router"
import { draftHref, rootSession, sessionHref, sessionQuery } from "@/utils/v2-route"
import { uuid } from "@/utils/uuid"
import { useGlobal } from "./global"
import { ServerConnection } from "./server"
import { useQueryClient } from "@tanstack/solid-query"
import { DirectoryState } from "./directory"
import { usePlatform } from "./platform"

export type SessionTab = {
  type: "session"
  server: ServerConnection.Key
  sessionId: string
}

export type DraftTab = {
  type: "draft"
  draftID: string
}

export type NewSessionDraft = {
  server: ServerConnection.Key
  directory: string
  worktree?: string
}

export type Tab = SessionTab | DraftTab

type State = {
  tabs: Tab[]
  drafts: Record<string, NewSessionDraft>
}

export const tabHref = (tab: Tab) =>
  tab.type === "draft" ? draftHref(tab.draftID) : sessionHref(tab.server, tab.sessionId)

export const tabKey = (tab: Tab) =>
  tab.type === "draft" ? `draft:${tab.draftID}` : `session:${tab.server}:${tab.sessionId}`

export const { use: useTabs, provider: TabsProvider } = createSimpleContext({
  name: "Tabs",
  gate: false,
  init: () => {
    const global = useGlobal()
    const navigate = useNavigate()
    const location = useLocation()
    const queryClient = useQueryClient()
    const platform = usePlatform()
    const [store, setStore, _, ready] = persisted(
      Persist.global("tabs.v2"),
      createStore<State>({ tabs: [], drafts: {} }),
    )

    const addSession = (tab: Omit<SessionTab, "type">) => {
      const next = { type: "session" as const, ...tab }
      setStore(
        "tabs",
        produce((tabs) => {
          if (!tabs.some((item) => tabKey(item) === tabKey(next))) tabs.push(next)
        }),
      )
    }

    const navigateTab = (tab: Tab) => navigate(tabHref(tab))
    const adjacent = (tab: Tab, offset: number) => {
      const index = store.tabs.findIndex((item) => tabKey(item) === tabKey(tab))
      const next = store.tabs[(index + offset + store.tabs.length) % store.tabs.length]
      if (next) navigateTab(next)
    }

    return {
      tabs: store.tabs,
      drafts: store.drafts,
      ready,
      draft(draftID: string) {
        const draft = store.drafts[draftID]
        if (!draft) throw new Error(`Draft not found: ${draftID}`)
        return draft
      },
      href: tabHref,
      admitSession: addSession,
      select(index: number) {
        const tab = store.tabs[index]
        if (tab) navigateTab(tab)
      },
      previous(tab: Tab) {
        adjacent(tab, -1)
      },
      next(tab: Tab) {
        adjacent(tab, 1)
      },
      openSession(server: ServerConnection.Key, sessionId: string) {
        navigate(sessionHref(server, sessionId))
        const context = global.servers.get(server)
        void queryClient
          .ensureQueryData(sessionQuery(server, context.instance, context.sdk, sessionId))
          .then((locator) =>
            rootSession(locator.session, (id) =>
              queryClient.ensureQueryData(sessionQuery(server, context.instance, context.sdk, id)).then((result) => result.session),
            ),
          )
          .then((root) => addSession({ server, sessionId: root.id }))
          .catch(() => undefined)
      },
      newDraft(draft: NewSessionDraft) {
        const draftID = uuid()
        setStore(
          produce((state) => {
            state.drafts[draftID] = draft
            state.tabs.push({ type: "draft", draftID })
          }),
        )
        navigate(draftHref(draftID))
      },
      updateDraft(draftID: string, draft: Partial<NewSessionDraft>) {
        setStore("drafts", draftID, (current) => ({ ...current, ...draft }))
      },
      promoteDraft(draftID: string, session: Omit<SessionTab, "type">) {
        const active = `${location.pathname}${location.search}` === draftHref(draftID)
        batch(() => {
          setStore(
            produce((state) => {
              const index = state.tabs.findIndex((tab) => tab.type === "draft" && tab.draftID === draftID)
              if (index !== -1) state.tabs[index] = { type: "session", ...session }
              delete state.drafts[draftID]
            }),
          )
          if (active) navigate(sessionHref(session.server, session.sessionId))
        })
        DirectoryState.removeDraft(draftID, platform)
      },
      close(tab: Tab, active: boolean) {
        const index = store.tabs.findIndex((item) => tabKey(item) === tabKey(tab))
        if (index === -1) return
        const next = store.tabs[index + 1] ?? store.tabs[index - 1]
        const draftID = tab.type === "draft" ? tab.draftID : undefined
        batch(() => {
          setStore(
            produce((state) => {
              const [tab] = state.tabs.splice(index, 1)
              if (tab?.type === "draft") delete state.drafts[tab.draftID]
            }),
          )
          if (!active) return
          if (next) navigateTab(next)
          if (!next) navigate("/")
        })
        if (draftID) DirectoryState.removeDraft(draftID, platform)
      },
      removeServer(key: ServerConnection.Key) {
        const drafts = Object.entries(store.drafts).flatMap(([draftID, draft]) => (draft.server === key ? [draftID] : []))
        setStore(
          produce((state) => {
            for (const [draftID, draft] of Object.entries(state.drafts)) {
              if (draft.server === key) delete state.drafts[draftID]
            }
            state.tabs = state.tabs.filter((tab) =>
              tab.type === "session" ? tab.server !== key : !!state.drafts[tab.draftID],
            )
          }),
        )
        for (const draftID of drafts) DirectoryState.removeDraft(draftID, platform)
      },
      removeSessions(server: ServerConnection.Key, sessionIDs: Set<string>) {
        setStore("tabs", (tabs) =>
          tabs.filter((tab) => tab.type !== "session" || tab.server !== server || !sessionIDs.has(tab.sessionId)),
        )
      },
    }
  },
})
