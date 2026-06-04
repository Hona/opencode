import { describe, expect, test } from "bun:test"
import {
  activeSessionTab,
  closeSessionTab,
  createDesktopTabs,
  openSessionRoute,
  removeUnavailableSessions,
} from "."

const root = { id: "root", title: "Root" }
const next = { id: "next", title: "Next" }
const rootRoute = { directory: "/workspace", sessionID: "root", href: "/workspace/session/root" }
const childRoute = { directory: "/workspace", sessionID: "child", href: "/workspace/session/child" }

describe("desktop session tabs", () => {
  test("binds a child route to its root tab", () => {
    const state = openSessionRoute(createDesktopTabs(), { route: childRoute, root, href: rootRoute.href })

    expect(state.tabs).toEqual([{ directory: "/workspace", rootID: "root", href: rootRoute.href, snapshot: root }])
    expect(activeSessionTab(state, childRoute.href)?.rootID).toBe("root")
  })

  test("does not duplicate a root tab for another route in the same tree", () => {
    const state = openSessionRoute(
      openSessionRoute(createDesktopTabs(), { route: rootRoute, root, href: rootRoute.href }),
      { route: childRoute, root, href: rootRoute.href },
    )

    expect(state.tabs).toHaveLength(1)
    expect(activeSessionTab(state, childRoute.href)?.rootID).toBe("root")
  })

  test("keeps the root tab during a child-first removal and navigates to the root", () => {
    const state = openSessionRoute(createDesktopTabs(), { route: childRoute, root, href: rootRoute.href })
    const result = removeUnavailableSessions(state, {
      directory: "/workspace",
      sessionIDs: ["child"],
      reason: "deleted",
      current: childRoute,
    })

    expect(result.state.tabs).toHaveLength(1)
    expect(result.navigate).toBe(rootRoute.href)
  })

  test("removes an active root tab and navigates to its neighbor", () => {
    const state = openSessionRoute(
      openSessionRoute(createDesktopTabs(), { route: childRoute, root, href: rootRoute.href }),
      {
        route: { directory: "/workspace", sessionID: "next", href: "/workspace/session/next" },
        root: next,
        href: "/workspace/session/next",
      },
    )
    const result = removeUnavailableSessions(state, {
      directory: "/workspace",
      sessionIDs: ["root"],
      reason: "deleted",
      current: childRoute,
    })

    expect(result.state.tabs.map((tab) => tab.rootID)).toEqual(["next"])
    expect(result.navigate).toBe("/workspace/session/next")
  })

  test("closes a tab with a pure navigation effect", () => {
    const state = openSessionRoute(
      openSessionRoute(createDesktopTabs(), { route: rootRoute, root, href: rootRoute.href }),
      {
        route: { directory: "/workspace", sessionID: "next", href: "/workspace/session/next" },
        root: next,
        href: "/workspace/session/next",
      },
    )

    expect(closeSessionTab(state, rootRoute.href)).toEqual({
      state: {
        tabs: [{ directory: "/workspace", rootID: "next", href: "/workspace/session/next", snapshot: next }],
        routeTabs: { "/workspace/session/next": "/workspace/session/next" },
      },
      navigate: "/workspace/session/next",
    })
  })
})
