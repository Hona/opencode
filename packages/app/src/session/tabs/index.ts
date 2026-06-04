export type SessionRoute = {
  directory: string
  sessionID: string
  href: string
}

export type SessionTab<T extends { id: string }> = {
  directory: string
  rootID: string
  href: string
  snapshot: T
}

export type DesktopTabs<T extends { id: string }> = {
  tabs: SessionTab<T>[]
  routeTabs: Record<string, string>
}

export function createDesktopTabs<T extends { id: string }>(): DesktopTabs<T> {
  return { tabs: [], routeTabs: {} }
}

export function openSessionRoute<T extends { id: string }>(
  state: DesktopTabs<T>,
  input: { route: SessionRoute; root: T; href: string },
) {
  const tab = { directory: input.route.directory, rootID: input.root.id, href: input.href, snapshot: input.root }
  const index = state.tabs.findIndex((item) => item.href === tab.href)
  return {
    tabs: index === -1 ? [...state.tabs, tab] : state.tabs.map((item, i) => (i === index ? tab : item)),
    routeTabs: { ...state.routeTabs, [input.route.href]: tab.href },
  }
}

export function activeSessionTab<T extends { id: string }>(state: DesktopTabs<T>, routeHref: string) {
  const href = state.routeTabs[routeHref] ?? routeHref
  return state.tabs.find((tab) => tab.href === href)
}

export function closeSessionTab<T extends { id: string }>(state: DesktopTabs<T>, href: string) {
  const index = state.tabs.findIndex((tab) => tab.href === href)
  if (index === -1) return { state }

  const tabs = state.tabs.filter((tab) => tab.href !== href)
  const routeTabs = Object.fromEntries(Object.entries(state.routeTabs).filter(([, tabHref]) => tabHref !== href))
  return { state: { tabs, routeTabs }, navigate: tabs[index]?.href ?? tabs[tabs.length - 1]?.href ?? "/" }
}

export function removeUnavailableSessions<T extends { id: string }>(
  state: DesktopTabs<T>,
  input: {
    directory: string
    sessionIDs: string[]
    reason: "archived" | "deleted"
    current?: SessionRoute
  },
) {
  const ids = new Set(input.sessionIDs)
  const currentHref = input.current ? (state.routeTabs[input.current.href] ?? input.current.href) : undefined
  const currentIndex = currentHref ? state.tabs.findIndex((tab) => tab.href === currentHref) : -1
  const tabs = state.tabs.filter((tab) => tab.directory !== input.directory || !ids.has(tab.rootID))
  const hrefs = new Set(tabs.map((tab) => tab.href))
  const routeTabs = Object.fromEntries(Object.entries(state.routeTabs).filter(([, tabHref]) => hrefs.has(tabHref)))
  const removedCurrent = currentIndex !== -1 && !hrefs.has(state.tabs[currentIndex]!.href)

  if (removedCurrent) return { state: { tabs, routeTabs }, navigate: tabs[currentIndex]?.href ?? tabs[tabs.length - 1]?.href ?? "/" }
  if (input.current?.directory === input.directory && ids.has(input.current.sessionID)) {
    return { state: { tabs, routeTabs }, navigate: tabs.find((tab) => tab.href === currentHref)?.href ?? "/" }
  }
  return { state: { tabs, routeTabs } }
}
