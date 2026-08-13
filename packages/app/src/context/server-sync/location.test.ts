import { expect, test } from "bun:test"
import { QueryClient } from "@tanstack/solid-query"
import type { OpenCodeEvent } from "@opencode-ai/client/promise"
import { ServerScope } from "@/utils/server-scope"
import { pathKey } from "@/utils/path-key"
import { createLocationSync } from "./location"

test("projects shell events and refreshes location catalogs", async () => {
  const queryClient = new QueryClient()
  const directory = pathKey("/repo")
  const calls: string[] = []
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const sync = createLocationSync({
    scope: ServerScope.local,
    queryClient,
    active: () => [directory],
    api: {
      location: { get: async () => Promise.reject(new Error("Unexpected location refresh")) },
      vcs: { get: async () => Promise.reject(new Error("Unexpected VCS refresh")) },
      skill: {
        list: async () => {
          calls.push("skill")
          return { location, data: [] }
        },
      },
      websearch: {
        providers: async () => {
          calls.push("websearch")
          return { location, data: [] }
        },
      },
      shell: {
        list: async () => Promise.reject(new Error("Unexpected shell refresh")),
      },
    },
  })

  sync.handleEvent(
    {
      type: "shell.created",
      id: "evt_1",
      data: {
        info: {
          id: "sh_1",
          status: "running",
          command: "echo hi",
          cwd: "/repo",
          shell: "bash",
          file: "",
          metadata: {},
          time: { started: 1 },
        },
      },
    } as OpenCodeEvent,
    directory,
  )
  sync.handleEvent({ type: "skill.updated", id: "evt_2", data: {} } as OpenCodeEvent, directory)
  sync.handleEvent({ type: "websearch.updated", id: "evt_3", data: {} } as OpenCodeEvent, directory)
  await Bun.sleep(0)

  expect(queryClient.getQueryData<unknown[]>([ServerScope.local, directory, "shell"])).toHaveLength(1)
  expect(calls).toEqual(["skill", "websearch"])
})
