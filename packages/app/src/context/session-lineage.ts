export async function hydrateSessionLineage<T extends { id: string; parentID?: string }>(
  session: T,
  get: (id: string) => T | undefined,
  load: (id: string) => Promise<T | undefined>,
) {
  const seen = new Set([session.id])
  let current = session

  while (current.parentID) {
    if (seen.has(current.parentID)) return
    seen.add(current.parentID)
    const parent = get(current.parentID) ?? (await load(current.parentID))
    if (!parent) return
    current = parent
  }
}

export function sessionTreeIDs(sessions: { id: string; parentID?: string }[], rootID: string) {
  const result = new Set([rootID])
  const byParent = sessions.reduce((acc, session) => {
    if (!session.parentID) return acc
    const children = acc.get(session.parentID)
    if (children) children.push(session.id)
    if (!children) acc.set(session.parentID, [session.id])
    return acc
  }, new Map<string, string[]>())
  const stack = [rootID]

  while (stack.length) {
    const parentID = stack.pop()
    if (!parentID) continue
    for (const child of byParent.get(parentID) ?? []) {
      if (result.has(child)) continue
      result.add(child)
      stack.push(child)
    }
  }

  return result
}
