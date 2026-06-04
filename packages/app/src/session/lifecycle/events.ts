import type { SessionsUnavailable } from "."

export const SESSIONS_UNAVAILABLE_EVENT = "opencode:sessions-unavailable"

export function publishSessionsUnavailable(change: SessionsUnavailable) {
  window.dispatchEvent(new CustomEvent(SESSIONS_UNAVAILABLE_EVENT, { detail: change }))
}

export function readSessionsUnavailable(event: Event): SessionsUnavailable | undefined {
  if (!(event instanceof CustomEvent)) return

  const detail: unknown = event.detail
  if (!detail || typeof detail !== "object") return
  if (!("directory" in detail) || typeof detail.directory !== "string") return
  if (!("sessionIDs" in detail) || !Array.isArray(detail.sessionIDs)) return
  if (!("reason" in detail) || (detail.reason !== "archived" && detail.reason !== "deleted")) return

  const sessionIDs = detail.sessionIDs.filter((id): id is string => typeof id === "string")
  if (sessionIDs.length === 0) return

  return { directory: detail.directory, sessionIDs, reason: detail.reason }
}
