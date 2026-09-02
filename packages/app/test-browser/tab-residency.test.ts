import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { ServerConnection } from "@/runtime/server/registry"
import { createTabResidency } from "@/shell/tabs/residency"
import type { Tab } from "@/shell/tabs/tabs"

const server = "local\nhttp://localhost:4096" as ServerConnection.Key
const other = "local\nhttp://localhost:4097" as ServerConnection.Key
const parents: Record<string, string | undefined> = { child: "root", grandchild: "child" }

function root(id: string): string {
  const parent = parents[id]
  return parent ? root(parent) : id
}

function setup(initial: Tab[], known = [server, other]) {
  return createRoot((dispose) => {
    const [tabs, setTabs] = createStore<Tab[]>(initial)
    const evicted: { server: ServerConnection.Key; id: string }[] = []
    createTabResidency({
      tabs: () => tabs,
      session: (key) =>
        known.includes(key) ? { root, evict: (id: string) => void evicted.push({ server: key, id }) } : undefined,
    })
    return {
      dispose,
      evicted,
      remove: (predicate: (tab: Tab) => boolean) =>
        setTabs(
          produce((list) => {
            const index = list.findIndex(predicate)
            if (index !== -1) list.splice(index, 1)
          }),
        ),
      route: (sessionId: string, routeSessionId: string | undefined) =>
        setTabs(
          (tab) => tab.type === "session" && tab.sessionId === sessionId,
          produce((tab) => {
            if (tab.type === "session") tab.routeSessionId = routeSessionId
          }),
        ),
    }
  })
}

function session(sessionId: string, key = server, routeSessionId?: string): Tab {
  return { type: "session", server: key, sessionId, routeSessionId }
}

describe("tab residency", () => {
  test("releases a family when its last tab closes and leaves other families alone", () => {
    const scope = setup([session("a"), session("b"), session("a", other)])
    try {
      expect(scope.evicted).toEqual([])
      scope.remove((tab) => tab.type === "session" && tab.sessionId === "a" && tab.server === server)
      expect(scope.evicted).toEqual([{ server, id: "a" }])
      scope.remove((tab) => tab.type === "session" && tab.sessionId === "b")
      expect(scope.evicted).toEqual([
        { server, id: "a" },
        { server, id: "b" },
      ])
    } finally {
      scope.dispose()
    }
  })

  test("keeps a family while any tab still shows one of its sessions", () => {
    const scope = setup([session("root", server, "grandchild"), session("child")])
    try {
      scope.remove((tab) => tab.type === "session" && tab.sessionId === "root")
      expect(scope.evicted).toEqual([])
      scope.remove((tab) => tab.type === "session" && tab.sessionId === "child")
      expect(scope.evicted).toEqual([{ server, id: "root" }])
    } finally {
      scope.dispose()
    }
  })

  test("navigating between children inside a tab does not release the family", () => {
    const scope = setup([session("root", server, "child")])
    try {
      scope.route("root", "grandchild")
      scope.route("root", undefined)
      expect(scope.evicted).toEqual([])
      scope.remove((tab) => tab.type === "session")
      expect(scope.evicted).toEqual([{ server, id: "root" }])
    } finally {
      scope.dispose()
    }
  })

  test("ignores drafts and servers without a context", () => {
    const draft: Tab = { type: "draft", server, draftID: "draft", directory: "/project" }
    const scope = setup([draft, session("gone", other)], [server])
    try {
      scope.remove((tab) => tab.type === "draft")
      scope.remove((tab) => tab.type === "session")
      expect(scope.evicted).toEqual([])
    } finally {
      scope.dispose()
    }
  })
})
