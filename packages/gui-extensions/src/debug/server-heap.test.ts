import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { captureServer } from "./server-heap"

// Main-process code: run it with the runtime's own fetch and Response, as Electron's main process has, not happy-dom's.
beforeAll(() => GlobalRegistrator.unregister())

afterAll(() => GlobalRegistrator.register())

test("moves a local server's snapshot into the folder and leaves a remote one where it is", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-server-heap-"))
  const written = path.join(root, "server-log", "heap-42-1.heapsnapshot")
  const directory = path.join(root, "capture")
  const requests: string[] = []

  using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      requests.push(`${request.method} ${new URL(request.url).pathname} ${request.headers.get("authorization")}`)
      await writeFile(written, "{}")

      return Response.json({ path: written, pid: 42 })
    },
  })

  const endpoint = { id: "sidecar", url: server.url.href, headers: { authorization: "Basic secret" } }
  await Promise.all([mkdir(path.dirname(written)), mkdir(directory)])

  const local = await captureServer({ ...endpoint, local: true }, directory, AbortSignal.timeout(10_000))
  const remote = await captureServer({ ...endpoint, local: false }, directory, AbortSignal.timeout(10_000))

  expect({ local, remote, requests }).toEqual({
    local: { process: "server", pid: 42, file: "server-42.heapsnapshot" },
    remote: { process: "server", pid: 42, path: written },
    requests: ["POST /api/debug/heap-dump Basic secret", "POST /api/debug/heap-dump Basic secret"],
  })
  expect(await readdir(directory)).toEqual(["server-42.heapsnapshot"])
  await rm(root, { recursive: true, force: true })
})

test("records why the server has no snapshot", async () => {
  using server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null, { status: 404 }) })
  const endpoint = { id: "sidecar", url: server.url.href, headers: {}, local: true }

  expect([
    await captureServer(undefined, os.tmpdir(), AbortSignal.timeout(10_000)),
    await captureServer(endpoint, os.tmpdir(), AbortSignal.timeout(10_000)),
  ]).toEqual([
    { process: "server", error: "The server is not connected." },
    { process: "server", error: "The server does not support heap dumps. Update and restart it." },
  ])
})
