import { describe, expect, test } from "bun:test"
import { loadedSessionTreeIDs, rootSession, sessionAndParentIDs, sessionChildOnPath } from "."

describe("session tree", () => {
  const sessions = [{ id: "root" }, { id: "child", parentID: "root" }, { id: "leaf", parentID: "child" }]

  test("returns the root session", () => {
    expect(rootSession(sessions, "leaf")).toEqual({ id: "root" })
    expect(rootSession(sessions, "root")).toEqual({ id: "root" })
  })

  test("waits for a missing parent session", () => {
    expect(rootSession([{ id: "leaf", parentID: "child" }], "leaf")).toBeUndefined()
  })

  test("ignores malformed cycles", () => {
    expect(rootSession([{ id: "a", parentID: "b" }, { id: "b", parentID: "a" }], "a")).toBeUndefined()
  })

  test("returns a session and its loaded parents", () => {
    expect(sessionAndParentIDs(sessions, "leaf")).toEqual(["leaf", "child", "root"])
  })

  test("collects a cached session tree", () => {
    expect([...loadedSessionTreeIDs(sessions, "root")]).toEqual(["root", "child", "leaf"])
  })

  test("finds the direct child on an active path", () => {
    expect(sessionChildOnPath(sessions, "root", "leaf")).toEqual({ id: "child", parentID: "root" })
  })
})
