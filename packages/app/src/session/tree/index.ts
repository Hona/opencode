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

export function cachedSessionTreeIDs(sessions: SessionNode[], rootID: string) {
  const ids = new Set([rootID])
  const queue = [rootID]

  for (const id of queue) {
    for (const session of sessions) {
      if (session.parentID !== id || ids.has(session.id)) continue
      ids.add(session.id)
      queue.push(session.id)
    }
  }

  return ids
}

export function sessionChildOnPath<T extends SessionNode>(sessions: T[], rootID: string, activeID: string) {
  if (rootID === activeID) return
  const byID = new Map(sessions.map((session) => [session.id, session]))
  const ids = sessionAndParentIDs(sessions, activeID)
  const index = ids.indexOf(rootID)
  if (index <= 0) return
  return byID.get(ids[index - 1]!)
}
