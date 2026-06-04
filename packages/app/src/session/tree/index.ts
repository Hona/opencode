export type SessionNode = {
  id: string
  parentID?: string
}

export function rootSession<T extends SessionNode>(sessions: T[], sessionID: string) {
  const byID = new Map(sessions.map((session) => [session.id, session]))
  const seen = new Set<string>()
  let session = byID.get(sessionID)

  while (session?.parentID) {
    if (seen.has(session.id)) return
    seen.add(session.id)
    session = byID.get(session.parentID)
  }

  return session
}

export function sessionAndParentIDs(sessions: SessionNode[], sessionID: string) {
  const byID = new Map(sessions.map((session) => [session.id, session]))
  const ids: string[] = []
  const seen = new Set<string>()
  let id: string | undefined = sessionID

  while (id && !seen.has(id)) {
    seen.add(id)
    ids.push(id)
    id = byID.get(id)?.parentID
  }

  return ids
}

export function loadedSessionTreeIDs(sessions: SessionNode[], rootID: string) {
  const ids = new Set([rootID])
  const queue = [rootID]
  const children = sessions.reduce((acc, session) => {
    if (!session.parentID) return acc
    const list = acc.get(session.parentID)
    if (list) list.push(session.id)
    if (!list) acc.set(session.parentID, [session.id])
    return acc
  }, new Map<string, string[]>())

  for (const id of queue) {
    for (const child of children.get(id) ?? []) {
      if (ids.has(child)) continue
      ids.add(child)
      queue.push(child)
    }
  }

  return ids
}

export function sessionChildOnPath<T extends SessionNode>(sessions: T[], rootID: string, activeID?: string) {
  if (!activeID || rootID === activeID) return
  const byID = new Map(sessions.map((session) => [session.id, session]))
  const ids = sessionAndParentIDs(sessions, activeID)
  const index = ids.indexOf(rootID)
  if (index > 0) return byID.get(ids[index - 1]!)
}
