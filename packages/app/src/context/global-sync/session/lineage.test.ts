import { describe, expect, test } from "bun:test"
import { hydrateSessionLineage } from "./lineage"

type TestSession = { id: string; parentID?: string; time?: { archived?: number } }

describe("session lineage hydration", () => {
  test("loads missing ancestors until the root is available", async () => {
    const sessions = new Map<string, TestSession>([["leaf", { id: "leaf", parentID: "child" }]])
    const available = new Map<string, TestSession>([
      ["child", { id: "child", parentID: "root" }],
      ["root", { id: "root" }],
    ])

    expect(
      await hydrateSessionLineage({
        session: sessions.get("leaf")!,
        get: (id) => sessions.get(id),
        load: async (id): Promise<TestSession | undefined> => {
          const session = available.get(id)
          if (session) sessions.set(id, session)
          return session
        },
        available: () => true,
      }),
    ).toEqual({ status: "resolved", rootID: "root" })
    expect([...sessions.keys()]).toEqual(["leaf", "child", "root"])
  })

  test("does not load an unavailable ancestor", async () => {
    const loaded: string[] = []

    expect(
      await hydrateSessionLineage({
        session: { id: "leaf", parentID: "root" } as TestSession,
        get: () => undefined,
        load: async (id): Promise<TestSession> => {
          loaded.push(id)
          return { id }
        },
        available: (id) => id !== "root",
      }),
    ).toEqual({ status: "unavailable", sessionID: "root" })
    expect(loaded).toEqual([])
  })

  test("rejects an archived ancestor returned by the backend", async () => {
    expect(
      await hydrateSessionLineage({
        session: { id: "leaf", parentID: "root" } as TestSession,
        get: () => undefined,
        load: async (): Promise<TestSession> => ({ id: "root", time: { archived: 10 } }),
        available: () => true,
      }),
    ).toEqual({ status: "unavailable", sessionID: "root" })
  })

  test("reports cyclic lineages", async () => {
    const sessions = new Map<string, TestSession>([
      ["child", { id: "child", parentID: "root" }],
      ["root", { id: "root", parentID: "child" }],
    ])

    expect(
      await hydrateSessionLineage({
        session: sessions.get("child")!,
        get: (id) => sessions.get(id),
        load: async () => undefined,
        available: () => true,
      }),
    ).toEqual({ status: "cycle", ids: ["child", "root"] })
  })
})
