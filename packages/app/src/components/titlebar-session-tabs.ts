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
  return () => {
    const info = get(tab.sessionId)
    return info ? { ...tab, info } : undefined
  }
}
