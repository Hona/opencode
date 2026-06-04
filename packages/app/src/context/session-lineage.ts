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
