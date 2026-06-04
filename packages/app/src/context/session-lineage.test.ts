import { describe, expect, test } from "bun:test"
import { hydrateSessionLineage } from "./session-lineage"

describe("session lineage", () => {
  test("hydrates missing ancestors for a routed subagent", async () => {
    const sessions = new Map<string, { id: string; parentID?: string }>([["leaf", { id: "leaf", parentID: "child" }]])
    const available = new Map<string, { id: string; parentID?: string }>([
      ["child", { id: "child", parentID: "root" }],
      ["root", { id: "root" }],
    ])

    await hydrateSessionLineage(
      sessions.get("leaf")!,
      (id) => sessions.get(id),
      async (id) => {
        const session = available.get(id)
        if (session) sessions.set(id, session)
        return session
      },
    )

    expect([...sessions.keys()]).toEqual(["leaf", "child", "root"])
  })

  test("stops hydrating cyclic lineages", async () => {
    const sessions = new Map([
      ["child", { id: "child", parentID: "root" }],
      ["root", { id: "root", parentID: "child" }],
    ])
    const loaded: string[] = []

    await hydrateSessionLineage(
      sessions.get("child")!,
      (id) => sessions.get(id),
      async (id) => {
        loaded.push(id)
        return sessions.get(id)
      },
    )

    expect(loaded).toEqual([])
  })
})
