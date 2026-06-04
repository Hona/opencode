export const SESSION_TABS_INVALIDATED_EVENT = "opencode:session-tabs-invalidated"

export type SessionTabsInvalidated = {
  directory: string
  sessionIDs: string[]
}

export function publishSessionTabsInvalidated(input: SessionTabsInvalidated) {
  window.dispatchEvent(new CustomEvent(SESSION_TABS_INVALIDATED_EVENT, { detail: input }))
}

export function readSessionTabsInvalidated(event: Event): SessionTabsInvalidated | undefined {
  if (!(event instanceof CustomEvent)) return

  const detail: unknown = event.detail
  if (!detail || typeof detail !== "object") return
  if (!("directory" in detail) || typeof detail.directory !== "string") return
  if (!("sessionIDs" in detail) || !Array.isArray(detail.sessionIDs)) return

  const sessionIDs = detail.sessionIDs.filter((id): id is string => typeof id === "string")
  if (sessionIDs.length === 0) return

  return { directory: detail.directory, sessionIDs }
}
