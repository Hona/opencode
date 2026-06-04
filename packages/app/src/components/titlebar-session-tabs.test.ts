import { describe, expect, test } from "bun:test"
import { createSessionTabResolver, getRootSession, removeUnavailableSessionTabs } from "./titlebar-session-tabs"

describe("titlebar session tabs", () => {
  test("uses the root session for subagent routes", () => {
    const sessions = [{ id: "root" }, { id: "child", parentID: "root" }, { id: "leaf", parentID: "child" }]

    expect(getRootSession("leaf", (id) => sessions.find((session) => session.id === id))?.id).toBe("root")
  })

  test("returns the routed session when it is a root", () => {
    const root = { id: "root" }

    expect(getRootSession("root", (id) => (id === root.id ? root : undefined))).toBe(root)
  })

  test("waits for delayed lineage rather than opening a subagent tab", () => {
    const sessions: { id: string; parentID?: string }[] = [{ id: "child", parentID: "root" }]
    const get = (id: string) => sessions.find((session) => session.id === id)

    expect(getRootSession("child", get)).toBeUndefined()
    sessions.push({ id: "root" })
    expect(getRootSession("child", get)?.id).toBe("root")
  })

  test("ignores incomplete and cyclic subagent paths", () => {
    const sessions = [
      { id: "missing-parent", parentID: "missing" },
      { id: "cycle-a", parentID: "cycle-b" },
      { id: "cycle-b", parentID: "cycle-a" },
    ]
    const get = (id: string) => sessions.find((session) => session.id === id)

    expect(getRootSession("missing-parent", get)).toBeUndefined()
    expect(getRootSession("cycle-a", get)).toBeUndefined()
  })

  test("resolves the latest title after a session is renamed", () => {
    const sessions = new Map([["root", { id: "root", title: "Before" }]])
    const resolve = createSessionTabResolver({ sessionId: "root" }, (id) => sessions.get(id))

    sessions.set("root", { id: "root", title: "After" })

    expect(resolve()?.info.title).toBe("After")
  })

  test("keeps the last root tab metadata after a remote archive", () => {
    const sessions = new Map([["root", { id: "root", title: "Root" }]])
    const resolve = createSessionTabResolver({ sessionId: "root" }, (id) => sessions.get(id))

    expect(resolve()?.info.title).toBe("Root")
    sessions.delete("root")
    expect(resolve()?.info.title).toBe("Root")
  })

  test("navigates after removing the active root tab from a subagent route", () => {
    const tabs = [
      { dir: "/workspace", sessionId: "root", href: "/workspace/session/root" },
      { dir: "/workspace", sessionId: "next", href: "/workspace/session/next" },
    ]

    expect(
      removeUnavailableSessionTabs(
        tabs,
        { directory: "/workspace", sessionIDs: ["root", "child"] },
        {
          href: "/workspace/session/child",
          sessionId: "child",
        },
      ),
    ).toBe("/workspace/session/next")
    expect(tabs).toEqual([{ dir: "/workspace", sessionId: "next", href: "/workspace/session/next" }])
  })

  test("navigates after child-first remote deletion events", () => {
    const tabs = [
      { dir: "/workspace", sessionId: "root", href: "/workspace/session/root" },
      { dir: "/workspace", sessionId: "next", href: "/workspace/session/next" },
    ]

    expect(
      removeUnavailableSessionTabs(
        tabs,
        { directory: "/workspace", sessionIDs: ["leaf"] },
        {
          href: "/workspace/session/root",
          sessionId: "leaf",
        },
      ),
    ).toBe("/workspace/session/root")
    expect(
      removeUnavailableSessionTabs(
        tabs,
        { directory: "/workspace", sessionIDs: ["root"] },
        {
          href: "/workspace/session/root",
          sessionId: "leaf",
        },
      ),
    ).toBe("/workspace/session/next")
  })
})
