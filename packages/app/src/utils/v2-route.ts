import { base64Encode } from "@opencode-ai/core/util/encode"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"
import { queryOptions } from "@tanstack/solid-query"
import type { ServerSDK } from "@/context/server-sdk"
import type { Session } from "@opencode-ai/sdk/v2/client"

export function sessionHref(server: ServerConnection.Key, sessionID: string) {
  return `/server/${base64Encode(server)}/session/${sessionID}`
}

export function draftHref(draftID: string) {
  return `/new-session?draftId=${encodeURIComponent(draftID)}`
}

export function requireServerKey(segment: string | undefined) {
  const key = decode64(segment)
  if (!key || base64Encode(key) !== segment) throw new Error("Invalid server route")
  return key as ServerConnection.Key
}

export function sessionQuery(server: ServerConnection.Key, instance: string, sdk: ServerSDK, sessionID: string) {
  return queryOptions({
    queryKey: ["v2", "session", server, instance, sessionID] as const,
    queryFn: () => sdk.client.session.get({ sessionID }).then((result) => ({ server, session: result.data! })),
  })
}

export async function rootSession(session: Session, get: (sessionID: string) => Promise<Session>) {
  let current = session
  while (current.parentID) current = await get(current.parentID)
  return current
}
