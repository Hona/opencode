export function getRootSession<T extends { id: string; parentID?: string }>(
  id: string,
  get: (id: string) => T | undefined,
) {
  const seen = new Set<string>()
  let session = get(id)

  while (session) {
    if (seen.has(session.id)) return
    seen.add(session.id)
    if (!session.parentID) return session
    session = get(session.parentID)
  }
}

export function createSessionTabResolver<T extends { sessionId: string }, U>(
  tab: T,
  get: (id: string) => U | undefined,
) {
  let cached: U | undefined
  return () => {
    cached = get(tab.sessionId) ?? cached
    return cached ? { ...tab, info: cached } : undefined
  }
}

export function findSessionTab<T extends { sessionId: string }>(
  tabs: T[],
  id: string,
  get: (id: string) => { parentID?: string } | undefined,
) {
  const seen = new Set<string>()
  let currentID: string | undefined = id

  while (currentID) {
    if (seen.has(currentID)) return
    seen.add(currentID)
    const tab = tabs.find((tab) => tab.sessionId === currentID)
    if (tab) return tab
    currentID = get(currentID)?.parentID
  }
}

export function removeDeletedSessionTabs<T extends { dir: string; sessionId: string; href: string }>(
  tabs: T[],
  input: { directory: string; sessionIDs: string[] },
  current?: { href: string; sessionId: string },
) {
  const sessionIDs = new Set(input.sessionIDs)
  const currentIndex = current
    ? tabs.findIndex(
        (tab) =>
          tab.href === current.href ||
          (sessionIDs.has(current.sessionId) && tab.dir === input.directory && sessionIDs.has(tab.sessionId)),
      )
    : -1
  const removedCurrent =
    currentIndex !== -1 &&
    tabs[currentIndex]?.dir === input.directory &&
    sessionIDs.has(tabs[currentIndex]?.sessionId ?? "")

  for (let i = tabs.length - 1; i >= 0; i--) {
    const tab = tabs[i]
    if (!tab) continue
    if (tab.dir !== input.directory) continue
    if (!sessionIDs.has(tab.sessionId)) continue
    tabs.splice(i, 1)
  }

  if (!removedCurrent) return
  return tabs[currentIndex]?.href ?? tabs[tabs.length - 1]?.href ?? "/"
}
