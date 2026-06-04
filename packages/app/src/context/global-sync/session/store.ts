import type { Session } from "@opencode-ai/sdk/v2/client"
import { Binary } from "@opencode-ai/core/util/binary"

export function upsertSession(sessions: Session[], session: Session) {
  const match = Binary.search(sessions, session.id, (item) => item.id)
  if (match.found) {
    sessions[match.index] = session
    return
  }
  sessions.splice(match.index, 0, session)
}
