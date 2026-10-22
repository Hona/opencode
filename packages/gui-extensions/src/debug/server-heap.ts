import { ClientError, OpenCode } from "@opencode/client/promise"
import { Predicate } from "effect"
import { copyFile, rename, rm } from "node:fs/promises"
import path from "node:path"
import type { ServerEndpoint } from "../sdk/main"

/**
 * What the manifest records about the server's snapshot.
 * - `file`: moved into the folder, named `server-<pid>.heapsnapshot`.
 * - `path`: left where the server wrote it, because the server runs on another machine or the move failed.
 * - `error`: nothing was captured.
 */
export type ServerSnapshot =
  | { readonly process: "server"; readonly pid: number; readonly file: string }
  | { readonly process: "server"; readonly pid: number; readonly path: string }
  | { readonly process: "server"; readonly error: string }

/**
 * Asks the server for a heap snapshot and, when it runs on this machine, moves the file into `directory`. Never
 * rejects: a failure becomes an `error` entry.
 *
 * @param endpoint - The server, or undefined when main does not know it.
 * @param directory - The folder the snapshot moves into.
 * @param signal - Aborts the request; the server still finishes the file it started.
 */
export async function captureServer(
  endpoint: ServerEndpoint | undefined,
  directory: string,
  signal: AbortSignal,
): Promise<ServerSnapshot> {
  if (!endpoint) return { process: "server", error: "The server is not connected." }

  return request(endpoint, directory, signal).catch((error: Error) => ({
    process: "server" as const,
    error: unsupported(error)
      ? "The server does not support heap dumps. Update and restart it."
      : error.message || String(error),
  }))
}

async function request(endpoint: ServerEndpoint, directory: string, signal: AbortSignal): Promise<ServerSnapshot> {
  const snapshot = await OpenCode.make({ baseUrl: endpoint.url, headers: endpoint.headers }).debug.heapDump({ signal })

  if (!endpoint.local) return { process: "server", pid: snapshot.pid, path: snapshot.path }
  const file = `server-${snapshot.pid}.heapsnapshot`
  const target = path.join(directory, file)

  // A rename fails across volumes, e.g. when Downloads is on another drive. When the copy fails too, the snapshot
  // still exists where the server wrote it.
  return rename(snapshot.path, target)
    .catch(async () => {
      await copyFile(snapshot.path, target)
      await rm(snapshot.path)
    })
    .then(
      (): ServerSnapshot => ({ process: "server", pid: snapshot.pid, file }),
      (): ServerSnapshot => ({ process: "server", pid: snapshot.pid, path: snapshot.path }),
    )
}

// Servers released before the endpoint answer 404.
function unsupported(error: Error) {
  return (
    error instanceof ClientError &&
    error.reason === "UnexpectedStatus" &&
    Predicate.hasProperty(error.cause, "status") &&
    error.cause.status === 404
  )
}
