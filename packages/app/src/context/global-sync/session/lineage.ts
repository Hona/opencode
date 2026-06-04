type SessionNode = {
  id: string
  parentID?: string
  time?: {
    archived?: number
  }
}

export type HydrateSessionLineageResult =
  | { status: "resolved"; rootID: string }
  | { status: "incomplete"; missingID: string }
  | { status: "unavailable"; sessionID: string }
  | { status: "cycle"; ids: string[] }

export async function hydrateSessionLineage<T extends SessionNode>(input: {
  session: T
  get: (sessionID: string) => T | undefined
  load: (sessionID: string) => Promise<T | undefined>
  available: (sessionID: string) => boolean
}): Promise<HydrateSessionLineageResult> {
  const ids: string[] = []
  const seen = new Set<string>()
  let session = input.session

  while (true) {
    if (seen.has(session.id)) return { status: "cycle", ids }
    seen.add(session.id)
    ids.push(session.id)

    if (session.time?.archived || !input.available(session.id)) return { status: "unavailable", sessionID: session.id }
    if (!session.parentID) return { status: "resolved", rootID: session.id }
    if (!input.available(session.parentID)) return { status: "unavailable", sessionID: session.parentID }

    const parent = input.get(session.parentID) ?? (await input.load(session.parentID))
    if (!parent) return { status: "incomplete", missingID: session.parentID }
    session = parent
  }
}
