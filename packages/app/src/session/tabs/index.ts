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
  routeHref?: string
  tabHref?: string
}

export function openSessionRoute<T extends { id: string }>(
  state: DesktopTabs<T>,
  input: { route: SessionRoute; root: T; rootHref: string },
) {
  const tab = { directory: input.route.directory, rootID: input.root.id, href: input.rootHref, snapshot: input.root }
  const index = state.tabs.findIndex((item) => item.href === tab.href)
  return {
    tabs: index === -1 ? [...state.tabs, tab] : state.tabs.map((item, i) => (i === index ? tab : item)),
    routeHref: input.route.href,
    tabHref: tab.href,
  }
}

export function activeSessionTab<T extends { id: string }>(state: DesktopTabs<T>, routeHref: string) {
  const href = state.routeHref === routeHref ? state.tabHref : routeHref
  return state.tabs.find((tab) => tab.href === href)
}

export function closeSessionTab<T extends { id: string }>(state: DesktopTabs<T>, href: string, routeHref?: string) {
  const index = state.tabs.findIndex((tab) => tab.href === href)
  if (index === -1) return { state }

  const tabs = state.tabs.filter((tab) => tab.href !== href)
  if (state.routeHref !== routeHref || state.tabHref !== href) return { state: { ...state, tabs } }

  const next = tabs[index] ?? tabs[tabs.length - 1]
  return {
    state: { tabs, routeHref: next?.href, tabHref: next?.href },
    navigate: next?.href ?? "/",
  }
}

export function removeUnavailableSessions<T extends { id: string }>(
  state: DesktopTabs<T>,
  input: {
    directory: string
    sessionIDs: string[]
    current?: SessionRoute
  },
) {
  const ids = new Set(input.sessionIDs)
  const current = input.current ? activeSessionTab(state, input.current.href) : undefined
  const currentIndex = current ? state.tabs.findIndex((tab) => tab.href === current.href) : -1
  const tabs = state.tabs.filter((tab) => tab.directory !== input.directory || !ids.has(tab.rootID))
  const removedCurrent = currentIndex !== -1 && !tabs.some((tab) => tab.href === current?.href)

  if (removedCurrent) {
    const next = tabs[currentIndex] ?? tabs[tabs.length - 1]
    return {
      state: { tabs, routeHref: next?.href, tabHref: next?.href },
      navigate: next?.href ?? "/",
    }
  }
  if (input.current?.directory === input.directory && ids.has(input.current.sessionID)) {
    return {
      state: { tabs, routeHref: current?.href, tabHref: current?.href },
      navigate: current?.href ?? "/",
    }
  }
  return { state: { ...state, tabs } }
}
