import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { Platform, Socket } from "@/context/platform"
import type { ServerConnection } from "@/context/server"

function auth(server: ServerConnection.HttpBase) {
  const user = server.username ?? "opencode"
  const pass = server.password
  return {
    user,
    pass,
    head: pass
      ? {
          Authorization: `Basic ${btoa(`${user}:${pass}`)}`,
        }
      : undefined,
  }
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const head = auth(server).head

  return createOpencodeClient({
    ...config,
    headers: { ...config.headers, ...head },
    baseUrl: server.url,
  })
}

export function createSocketForServer({
  input,
  server,
  socket,
}: {
  input: string
  server: ServerConnection.HttpBase
  socket?: Platform["socket"]
}): Socket {
  const url = new URL(input, server.url)
  if (url.protocol === "http:") url.protocol = "ws:"
  if (url.protocol === "https:") url.protocol = "wss:"

  const next = auth(server)
  if (socket) return socket(url.toString(), next.head ? { headers: next.head } : undefined)
  if (next.pass) {
    url.username = next.user
    url.password = next.pass
  }
  return new WebSocket(url)
}
