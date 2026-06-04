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
  active?: {
    route: SessionRoute
    tabHref: string
  }
}

export function openSessionRoute<T extends { id: string }>(
  state: DesktopTabs<T>,
  input: { route: SessionRoute; root: T; rootHref: string },
) {
  const tab = { directory: input.route.directory, rootID: input.root.id, href: input.rootHref, snapshot: input.root }
  const index = state.tabs.findIndex((item) => item.href === tab.href)
  return {
    tabs: index === -1 ? [...state.tabs, tab] : state.tabs.map((item, i) => (i === index ? tab : item)),
    active: { route: input.route, tabHref: tab.href },
  }
}

export function activeSessionTab<T extends { id: string }>(state: DesktopTabs<T>, routeHref: string) {
  const href = state.active?.route.href === routeHref ? state.active.tabHref : routeHref
  return state.tabs.find((tab) => tab.href === href)
}

export function closeSessionTab<T extends { id: string }>(state: DesktopTabs<T>, href: string, routeHref?: string) {
  const index = state.tabs.findIndex((tab) => tab.href === href)
  if (index === -1) return { state }

  const tabs = state.tabs.filter((tab) => tab.href !== href)
  if (state.active?.route.href !== routeHref || state.active?.tabHref !== href) return { state: { ...state, tabs } }

  const next = tabs[index] ?? tabs[tabs.length - 1]
  return {
    state: { tabs, active: next ? { route: { directory: next.directory, sessionID: next.rootID, href: next.href }, tabHref: next.href } : undefined },
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
      state: { tabs, active: next ? { route: { directory: next.directory, sessionID: next.rootID, href: next.href }, tabHref: next.href } : undefined },
      navigate: next?.href ?? "/",
    }
  }
  if (input.current?.directory === input.directory && ids.has(input.current.sessionID)) {
    return {
      state: { tabs, active: current ? { route: { directory: current.directory, sessionID: current.rootID, href: current.href }, tabHref: current.href } : undefined },
      navigate: current?.href ?? "/",
    }
  }
  if (state.active?.route.directory === input.directory && ids.has(state.active.route.sessionID)) {
    return { state: { tabs } }
  }
  return { state: { ...state, tabs } }
}
