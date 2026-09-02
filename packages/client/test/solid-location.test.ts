import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent } from "../src/promise"

const held = { directory: "/held" }
const released = { directory: "/released" }

test("releasing the last hold drops catalogs, keeps light metadata, and reloads on the next sync", async () => {
  const setup = fixture()
  try {
    const release = setup.data.location.retain(released)
    const again = setup.data.location.retain(released)
    await Promise.all([setup.data.location.sync(released), setup.data.location.sync(held)])
    setup.requests.length = 0

    release()
    await setup.settle()
    expect(setup.data.location.model.list(released)).toHaveLength(1)
    again()
    again()
    expect(setup.data.location.model.list(released)).toHaveLength(1)
    await setup.settle()
    expect(setup.data.location.model.list(released)).toBeUndefined()
    expect(setup.data.location.provider.list(released)).toBeUndefined()
    expect(setup.data.location.agent.list(released)).toBeUndefined()
    expect(setup.data.location.command.list(released)).toBeUndefined()
    expect(setup.data.location.skill.list(released)).toBeUndefined()
    expect(setup.data.location.integration.list(released)).toBeUndefined()
    expect(setup.data.location.mcp.server.list(released)).toBeUndefined()
    expect(setup.data.location.mcp.resource.list(released)).toBeUndefined()
    expect(setup.data.location.reference.list(released)).toBeUndefined()
    expect(setup.data.location.info(released)?.directory).toBe("/released")
    expect(setup.data.location.vcs.info(released)?.branch.current).toBe("main")
    expect(setup.data.location.model.list(held)).toHaveLength(1)
    expect(setup.requests).toEqual([])

    await setup.data.location.model.sync(released)
    expect(setup.requests).toEqual(["/api/model /released"])
    expect(setup.data.location.model.list(released)).toHaveLength(1)
  } finally {
    setup.dispose()
  }
})

test("a hold re-acquired within the same task keeps the catalogs", async () => {
  const setup = fixture()
  try {
    const release = setup.data.location.retain(released)
    await setup.data.location.sync(released)
    setup.requests.length = 0
    release()
    const next = setup.data.location.retain(released)
    await setup.settle()
    expect(setup.data.location.model.list(released)).toHaveLength(1)
    await setup.data.location.model.sync(released)
    expect(setup.requests).toEqual([])
    next()
    await setup.settle()
    expect(setup.data.location.model.list(released)).toBeUndefined()
  } finally {
    setup.dispose()
  }
})

test("the default location stays resident after its holds release", async () => {
  const setup = fixture()
  try {
    await setup.data.location.sync()
    const release = setup.data.location.retain(setup.data.location.default())
    release()
    await setup.settle()
    expect(setup.data.location.model.list()).toHaveLength(1)
    expect(setup.data.location.model.list({ directory: "/project" })).toHaveLength(1)
  } finally {
    setup.dispose()
  }
})

test("event-driven refreshes reload only catalogs that are loaded or loading", async () => {
  const setup = fixture()
  try {
    const release = setup.data.location.retain(released)
    await Promise.all([setup.data.location.sync(released), setup.data.location.sync(held)])
    release()
    await setup.settle()
    setup.requests.length = 0

    setup.emit({ id: "evt_credential", created: 1, type: "credential.updated", data: {} })
    setup.emit({
      id: "evt_switched",
      created: 2,
      type: "credential.switched",
      data: { integrationID: "integration", credentialID: "credential" },
    })
    await setup.settle()
    expect(setup.requests.toSorted()).toEqual(["/api/integration /held", "/api/model /held", "/api/provider /held"])
    setup.requests.length = 0

    for (const type of ["catalog.updated", "agent.updated", "command.updated", "skill.updated"] as const) {
      setup.emit({ id: `evt_${type}_released`, created: 3, type, location: released, data: {} })
      setup.emit({ id: `evt_${type}_unknown`, created: 3, type, location: { directory: "/never" }, data: {} })
      setup.emit({ id: `evt_${type}_held`, created: 3, type, location: held, data: {} })
    }
    await setup.settle()
    expect(setup.requests.toSorted()).toEqual([
      "/api/agent /held",
      "/api/command /held",
      "/api/model /held",
      "/api/provider /held",
      "/api/skill /held",
    ])
    expect(setup.data.location.model.list(released)).toBeUndefined()
  } finally {
    setup.dispose()
  }
})

test("an event during the first load still refreshes after that load settles", async () => {
  const gate = Promise.withResolvers<void>()
  const setup = fixture(async (url) => {
    if (url.pathname === "/api/model" && url.searchParams.get("location[directory]") === "/held") await gate.promise
  })
  try {
    const initial = setup.data.location.model.sync(held)
    setup.emit({ id: "evt_catalog", created: 1, type: "catalog.updated", location: held, data: {} })
    gate.resolve()
    await initial
    await setup.settle()
    expect(setup.requests.filter((request) => request === "/api/model /held")).toHaveLength(2)
  } finally {
    gate.resolve()
    setup.dispose()
  }
})

function fixture(before?: (url: URL) => Promise<void>) {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const requests: string[] = []
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      const directory = url.searchParams.get("location[directory]") || "/project"
      requests.push(`${url.pathname} ${directory}`)
      await before?.(url)
      const location = { directory, project: { id: "project", directory, canonical: directory } }
      if (url.pathname === "/api/location") return Response.json(location)
      if (url.pathname === "/api/vcs") return Response.json({ location, data: { branch: { current: "main" } } })
      if (url.pathname === "/api/mcp/resource")
        return Response.json({ location, data: { resources: [{ server: "mcp", uri: "file://x" }], templates: [] } })
      if (url.pathname === "/api/shell") return Response.json({ location, data: [] })
      if (url.pathname === "/api/form/request") return Response.json({ location, data: [] })
      return Response.json({ location, data: [{ id: `${url.pathname}:${directory}`, providerID: "opencode" }] })
    },
  })
  return createRoot((dispose) => {
    const data = createData({
      api: () => api,
      directory: "",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
      connection: { status: () => "connected" },
    })
    return {
      data,
      requests,
      dispose,
      emit: (details: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: details.type, details })),
      // Event handlers issue their reads synchronously; a macrotask lets those reads settle.
      settle: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    }
  })
}
