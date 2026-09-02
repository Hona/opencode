import { describe, expect, test } from "bun:test"
import { OpenCode } from "@opencode-ai/client/promise"
import { createData } from "@opencode-ai/client/solid"
import type { SessionInfo } from "@opencode-ai/client/promise"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import type { ServerConnection } from "@/runtime/server/registry"
import type { Tab } from "@/shell/tabs/tabs"
import { createLocationResidency } from "@/runtime/server/residency"

const server = "local" as ServerConnection.Key
const other = "http://remote:4096" as ServerConnection.Key

function session(id: string, directory: string): SessionInfo {
  return {
    id,
    projectID: "project",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
    location: { directory },
  }
}

function fixture() {
  const requests: string[] = []
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        const url = new URL(request.url)
        const directory = url.searchParams.get("location[directory]") ?? "/default"
        requests.push(`${url.pathname} ${directory}`)
        return Response.json({
          location: { directory, project: { id: "project", directory, canonical: directory } },
          data: [{ id: `model-${directory}`, providerID: "opencode" }],
        })
      },
      { preconnect() {} },
    ),
  })
  return createRoot((dispose) => {
    const [tabs, setTabs] = createStore<Tab[]>([])
    const data = createData({
      api: () => api,
      directory: "/default",
      event: { on: () => () => {}, listen: () => () => {} },
    })
    createLocationResidency({ key: server, tabs: () => tabs, data })
    // Releases drop catalogs after the current task.
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
    return { data, tabs, setTabs, requests, settle, dispose }
  })
}

describe("location residency", () => {
  test("keeps catalogs for open tabs and releases them when the last tab closes", async () => {
    const setup = fixture()
    try {
      setup.data.session.remember(session("ses_a", "/repo/a"))
      setup.data.session.remember(session("ses_b", "/repo/a"))
      setup.setTabs([
        { type: "session", server, sessionId: "ses_a" },
        { type: "session", server, sessionId: "ses_b" },
        { type: "draft", server, draftID: "draft", directory: "/repo/draft" },
        { type: "session", server: other, sessionId: "ses_a" },
      ])
      await setup.data.location.model.sync({ directory: "/repo/a" })
      await setup.data.location.model.sync({ directory: "/repo/draft" })
      expect(setup.requests).toEqual(["/api/model /repo/a", "/api/model /repo/draft"])

      setup.setTabs((tabs) => tabs.filter((tab) => tab.type !== "session" || tab.sessionId !== "ses_a"))
      await setup.settle()
      expect(setup.data.location.model.list({ directory: "/repo/a" })).toHaveLength(1)

      setup.setTabs((tabs) => tabs.filter((tab) => tab.type !== "session" || tab.server !== server))
      await setup.settle()
      expect(setup.data.location.model.list({ directory: "/repo/a" })).toBeUndefined()
      expect(setup.data.location.model.list({ directory: "/repo/draft" })).toHaveLength(1)

      setup.setTabs([])
      await setup.settle()
      expect(setup.data.location.model.list({ directory: "/repo/draft" })).toBeUndefined()

      await setup.data.location.model.sync({ directory: "/repo/a" })
      expect(setup.requests).toHaveLength(3)
      expect(setup.data.location.model.list({ directory: "/repo/a" })).toHaveLength(1)
    } finally {
      setup.dispose()
    }
  })

  test("holds a session tab's directory once its session info arrives", async () => {
    const setup = fixture()
    try {
      setup.setTabs([{ type: "session", server, sessionId: "ses_late" }])
      await setup.data.location.model.sync({ directory: "/repo/late" })
      setup.data.session.remember(session("ses_late", "/repo/late"))
      setup.setTabs([])
      await setup.settle()
      expect(setup.data.location.model.list({ directory: "/repo/late" })).toBeUndefined()
    } finally {
      setup.dispose()
    }
  })

  test("promoting a draft to a session tab keeps the directory resident", async () => {
    const setup = fixture()
    try {
      setup.data.session.remember(session("ses_new", "/repo/a"))
      setup.setTabs([{ type: "draft", server, draftID: "draft", directory: "/repo/a" }])
      await setup.data.location.model.sync({ directory: "/repo/a" })
      setup.requests.length = 0
      setup.setTabs([{ type: "session", server, sessionId: "ses_new" }])
      await setup.settle()
      expect(setup.data.location.model.list({ directory: "/repo/a" })).toHaveLength(1)
      await setup.data.location.model.sync({ directory: "/repo/a" })
      expect(setup.requests).toEqual([])
    } finally {
      setup.dispose()
    }
  })
})
