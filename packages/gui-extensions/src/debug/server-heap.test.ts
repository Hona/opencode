import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { captureServer } from "./server-heap"

// Main-process code: run it with the runtime's own fetch and Response, as Electron's main process has, not happy-dom's.
beforeAll(() => GlobalRegistrator.unregister())

afterAll(() => GlobalRegistrator.register())

test("moves the server's snapshot into the folder, and leaves it in place when it cannot be renamed", async () => {
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

  const endpoint = { id: "sidecar", url: server.url.href, headers: { authorization: "Basic secret" }, local: true }
  await Promise.all([mkdir(path.dirname(written)), mkdir(directory)])

  const moved = await captureServer(endpoint, directory, AbortSignal.timeout(10_000))
  // A rename into a missing folder fails like one across drives; the snapshot is not copied.
  const kept = await captureServer(endpoint, path.join(root, "missing"), AbortSignal.timeout(10_000))

  expect({ moved, kept, requests }).toEqual({
    moved: { process: "server", pid: 42, file: "server-42.heapsnapshot" },
    kept: { process: "server", pid: 42, path: written },
    requests: ["POST /api/debug/heap-dump Basic secret", "POST /api/debug/heap-dump Basic secret"],
  })
  expect(await readdir(directory)).toEqual(["server-42.heapsnapshot"])
  expect(await readdir(path.dirname(written))).toEqual(["heap-42-1.heapsnapshot"])
  await rm(root, { recursive: true, force: true })
})

test("records why the server has no snapshot", async () => {
  using server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null, { status: 404 }) })
  const endpoint = { id: "sidecar", url: server.url.href, headers: {}, local: true }

  expect([
    await captureServer(undefined, os.tmpdir(), AbortSignal.timeout(10_000)),
    await captureServer(endpoint, os.tmpdir(), AbortSignal.timeout(10_000)),
  ]).toEqual([
    { process: "server", error: "The server is not running." },
    { process: "server", error: "The server does not support heap dumps. Update and restart it." },
  ])
})
