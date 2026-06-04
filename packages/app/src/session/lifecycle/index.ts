export type SessionAvailabilityReason = "archived" | "deleted"

export type SessionsUnavailable = {
  directory: string
  sessionIDs: string[]
  reason: SessionAvailabilityReason
}
