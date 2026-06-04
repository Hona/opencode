type SessionNode = {
  id: string
  parentID?: string
  time?: {
    archived?: number
  }
}

export async function loadMissingSessionParents<T extends SessionNode>(input: {
  session: T
  get: (sessionID: string) => T | undefined
  load: (sessionID: string) => Promise<T | undefined>
  available: (sessionID: string) => boolean
}) {
  const seen = new Set<string>()
  let session = input.session

  while (session.parentID) {
    if (seen.has(session.id)) return
    seen.add(session.id)
    if (!input.available(session.parentID)) return

    const parent = input.get(session.parentID) ?? (await input.load(session.parentID))
    if (!parent || parent.time?.archived !== undefined) return
    session = parent
  }
}
