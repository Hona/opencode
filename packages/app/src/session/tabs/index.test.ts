import { describe, expect, test } from "bun:test"
import { activeSessionTab, closeSessionTab, openSessionRoute, removeUnavailableSessions, type DesktopTabs } from "."

const root = { id: "root", title: "Root" }
const next = { id: "next", title: "Next" }
const rootRoute = { directory: "/workspace", sessionID: "root", href: "/workspace/session/root" }
const childRoute = { directory: "/workspace", sessionID: "child", href: "/workspace/session/child" }
const nextRoute = { directory: "/workspace", sessionID: "next", href: "/workspace/session/next" }
const empty = (): DesktopTabs<typeof root> => ({ tabs: [] })

describe("desktop session tabs", () => {
  test("opens one active root tab for routes in the same session tree", () => {
    const state = openSessionRoute(
      openSessionRoute(empty(), { route: rootRoute, root, rootHref: rootRoute.href }),
      { route: childRoute, root, rootHref: rootRoute.href },
    )

    expect(state.tabs.map((tab) => tab.rootID)).toEqual(["root"])
    expect(activeSessionTab(state, childRoute.href)?.rootID).toBe("root")
  })

  test("removes an unavailable child binding and navigates to the retained root tab", () => {
    const result = removeUnavailableSessions(
      openSessionRoute(empty(), { route: childRoute, root, rootHref: rootRoute.href }),
      { directory: "/workspace", sessionIDs: ["child"], current: childRoute },
    )

    expect(result.state.tabs.map((tab) => tab.rootID)).toEqual(["root"])
    expect(activeSessionTab(result.state, childRoute.href)).toBeUndefined()
    expect(activeSessionTab(result.state, rootRoute.href)?.rootID).toBe("root")
    expect(result.navigate).toBe(rootRoute.href)
  })

  test("removes an active root tab and navigates to its neighbor", () => {
    const result = removeUnavailableSessions(
      openSessionRoute(
        openSessionRoute(empty(), { route: childRoute, root, rootHref: rootRoute.href }),
        { route: nextRoute, root: next, rootHref: nextRoute.href },
      ),
      { directory: "/workspace", sessionIDs: ["next"], current: nextRoute },
    )

    expect(result.state.tabs.map((tab) => tab.rootID)).toEqual(["root"])
    expect(result.navigate).toBe(rootRoute.href)
  })

  test("closes an active tab with a navigation effect", () => {
    const result = closeSessionTab(
      openSessionRoute(
        openSessionRoute(empty(), { route: rootRoute, root, rootHref: rootRoute.href }),
        { route: nextRoute, root: next, rootHref: nextRoute.href },
      ),
      nextRoute.href,
      nextRoute.href,
    )

    expect(result.state.tabs.map((tab) => tab.rootID)).toEqual(["root"])
    expect(result.navigate).toBe(rootRoute.href)
  })

  test("closes a background tab without navigating", () => {
    const result = closeSessionTab(
      openSessionRoute(
        openSessionRoute(empty(), { route: rootRoute, root, rootHref: rootRoute.href }),
        { route: nextRoute, root: next, rootHref: nextRoute.href },
      ),
      rootRoute.href,
      nextRoute.href,
    )

    expect(result.state.tabs.map((tab) => tab.rootID)).toEqual(["next"])
    expect(result.navigate).toBeUndefined()
  })

  test("navigates home after closing the final active tab", () => {
    const result = closeSessionTab(
      openSessionRoute(empty(), { route: rootRoute, root, rootHref: rootRoute.href }),
      rootRoute.href,
      rootRoute.href,
    )

    expect(result.state.tabs).toEqual([])
    expect(result.navigate).toBe("/")
  })

  test("closes a previous session tab without leaving the new session route", () => {
    const result = closeSessionTab(
      openSessionRoute(empty(), { route: rootRoute, root, rootHref: rootRoute.href }),
      rootRoute.href,
    )

    expect(result.state.tabs).toEqual([])
    expect(result.navigate).toBeUndefined()
  })

  test("keeps tabs from other directories", () => {
    const otherRoute = { directory: "/other", sessionID: "root", href: "/other/session/root" }
    const result = removeUnavailableSessions(
      openSessionRoute(
        openSessionRoute(empty(), { route: rootRoute, root, rootHref: rootRoute.href }),
        { route: otherRoute, root, rootHref: otherRoute.href },
      ),
      { directory: "/workspace", sessionIDs: ["root"], current: rootRoute },
    )

    expect(result.state.tabs.map((tab) => tab.directory)).toEqual(["/other"])
  })
})
