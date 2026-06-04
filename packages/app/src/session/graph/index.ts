export type SessionNode = {
  id: string
  parentID?: string
}

export type RootResolution =
  | { status: "resolved"; rootID: string }
  | { status: "incomplete"; missingID: string }
  | { status: "cycle"; ids: string[] }

export function createSessionGraph(sessions: SessionNode[]) {
  const byID = new Map(sessions.map((session) => [session.id, session]))
  const byParent = sessions.reduce((result, session) => {
    if (!session.parentID) return result
    const children = result.get(session.parentID)
    if (children) children.push(session.id)
    if (!children) result.set(session.parentID, [session.id])
    return result
  }, new Map<string, string[]>())

  return {
    resolveRoot(sessionID: string): RootResolution {
      const ids: string[] = []
      const seen = new Set<string>()
      let id = sessionID

      while (true) {
        if (seen.has(id)) return { status: "cycle", ids }
        seen.add(id)
        ids.push(id)

        const session = byID.get(id)
        if (!session) return { status: "incomplete", missingID: id }
        if (!session.parentID) return { status: "resolved", rootID: session.id }
        id = session.parentID
      }
    },
    ancestors(sessionID: string) {
      const ids: string[] = []
      const seen = new Set<string>()
      let id: string | undefined = sessionID

      while (id && !seen.has(id)) {
        seen.add(id)
        ids.push(id)
        id = byID.get(id)?.parentID
      }

      return ids
    },
    cachedSubtreeIDs(rootID: string) {
      const ids = new Set([rootID])
      const queue = [rootID]

      for (const id of queue) {
        for (const child of byParent.get(id) ?? []) {
          if (ids.has(child)) continue
          ids.add(child)
          queue.push(child)
        }
      }

      return ids
    },
    contains(rootID: string, sessionID: string) {
      return this.ancestors(sessionID).includes(rootID)
    },
    childOnPath(rootID: string, activeID: string) {
      if (rootID === activeID) return
      const ids = this.ancestors(activeID)
      const index = ids.indexOf(rootID)
      if (index <= 0) return
      return ids[index - 1]
    },
  }
}
