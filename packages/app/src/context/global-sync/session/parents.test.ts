import { describe, expect, test } from "bun:test"
import { loadMissingSessionParents } from "./parents"

type TestSession = { id: string; parentID?: string; time?: { archived?: number } }

describe("load missing session parents", () => {
  test("loads missing parents until the root is available", async () => {
    const sessions = new Map<string, TestSession>([["leaf", { id: "leaf", parentID: "child" }]])
    const available = new Map<string, TestSession>([
      ["child", { id: "child", parentID: "root" }],
      ["root", { id: "root" }],
    ])

    await loadMissingSessionParents<TestSession>({
      session: sessions.get("leaf")!,
      get: (id) => sessions.get(id),
      load: async (id) => {
        const session = available.get(id)
        if (session) sessions.set(id, session)
        return session
      },
      available: () => true,
    })

    expect([...sessions.keys()]).toEqual(["leaf", "child", "root"])
  })

  test("does not load an unavailable parent", async () => {
    const loaded: string[] = []

    await loadMissingSessionParents<TestSession>({
      session: { id: "leaf", parentID: "root" },
      get: () => undefined,
      load: async (id) => {
        loaded.push(id)
        return { id }
      },
      available: () => false,
    })

    expect(loaded).toEqual([])
  })

  test("stops at an archived parent returned by the backend", async () => {
    const loaded: string[] = []

    await loadMissingSessionParents<TestSession>({
      session: { id: "leaf", parentID: "root" },
      get: () => undefined,
      load: async (id) => {
        loaded.push(id)
        return { id, parentID: "older", time: { archived: 10 } }
      },
      available: () => true,
    })

    expect(loaded).toEqual(["root"])
  })

  test("stops at malformed cycles", async () => {
    const sessions = new Map<string, TestSession>([
      ["child", { id: "child", parentID: "root" }],
      ["root", { id: "root", parentID: "child" }],
    ])

    await loadMissingSessionParents({
      session: sessions.get("child")!,
      get: (id) => sessions.get(id),
      load: async () => undefined,
      available: () => true,
    })
  })
})
