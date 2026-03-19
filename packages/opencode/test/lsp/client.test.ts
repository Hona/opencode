import { describe, expect, test, beforeEach } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Path } from "../../src/path/path"
import { LSPClient } from "../../src/lsp/client"
import { LSPServer } from "../../src/lsp/server"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

// Minimal fake LSP server that speaks JSON-RPC over stdio
function spawnFakeServer() {
  const { spawn } = require("child_process")
  const serverPath = path.join(__dirname, "../fixture/lsp/fake-lsp-server.js")
  return {
    process: spawn(process.execPath, [serverPath], {
      stdio: "pipe",
    }),
  }
}

describe("LSPClient interop", () => {
  beforeEach(async () => {
    await Log.init({ print: true })
  })

  test("handles workspace/workspaceFolders request", async () => {
    const handle = spawnFakeServer() as any

    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: Path.pretty(process.cwd()),
        }),
    })

    await client.connection.sendNotification("test/trigger", {
      method: "workspace/workspaceFolders",
    })

    await new Promise((r) => setTimeout(r, 100))

    expect(client.connection).toBeDefined()

    await client.shutdown()
  })

  test("handles client/registerCapability request", async () => {
    const handle = spawnFakeServer() as any

    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: Path.pretty(process.cwd()),
        }),
    })

    await client.connection.sendNotification("test/trigger", {
      method: "client/registerCapability",
    })

    await new Promise((r) => setTimeout(r, 100))

    expect(client.connection).toBeDefined()

    await client.shutdown()
  })

  test("handles client/unregisterCapability request", async () => {
    const handle = spawnFakeServer() as any

    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: Path.pretty(process.cwd()),
        }),
    })

    await client.connection.sendNotification("test/trigger", {
      method: "client/unregisterCapability",
    })

    await new Promise((r) => setTimeout(r, 100))

    expect(client.connection).toBeDefined()

    await client.shutdown()
  })

  test("preserves alias paths in diagnostics", async () => {
    if (process.platform !== "win32") return
    await using tmp = await tmpdir()

    const target = path.join(tmp.path, "Target")
    const alias = path.join(tmp.path, "Alias")
    const file = path.join(alias, "file.ts")
    const real = path.join(target, "file.ts")
    await fs.mkdir(target, { recursive: true })
    await fs.symlink(target, alias, "junction")
    await Bun.write(file, "const x = 1\n")

    const handle = spawnFakeServer() as any

    const client = await Instance.provide({
      directory: alias,
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: Path.pretty(alias),
        }),
    })

    await client.connection.sendNotification("test/publishDiagnostics", {
      uri: String(Path.uri(file)),
      diagnostics: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          message: "boom",
          severity: 1,
        },
      ],
    })

    await new Promise((r) => setTimeout(r, 100))

    expect([...client.diagnostics.entries()]).toEqual([
      [
        file,
        [
          expect.objectContaining({
            message: "boom",
            severity: 1,
          }),
        ],
      ],
    ])
    expect([...client.diagnostics.keys()]).not.toContain(real)

    await client.shutdown()
  })

  test("coalesces diagnostics by path key", async () => {
    if (process.platform !== "win32") return
    await using tmp = await tmpdir()

    const file = path.join(tmp.path, "File.ts")
    await Bun.write(file, "const x = 1\n")
    const lower = file.toLowerCase()

    const handle = spawnFakeServer() as any

    const client = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: Path.pretty(tmp.path),
        }),
    })

    await client.connection.sendNotification("test/publishDiagnostics", {
      uri: String(Path.uri(file)),
      diagnostics: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          message: "first",
          severity: 1,
        },
      ],
    })
    await client.connection.sendNotification("test/publishDiagnostics", {
      uri: String(Path.uri(lower)),
      diagnostics: [
        {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 1 },
          },
          message: "second",
          severity: 1,
        },
      ],
    })

    await new Promise((r) => setTimeout(r, 100))

    expect([...client.diagnostics.entries()]).toEqual([
      [
        file,
        [
          expect.objectContaining({
            message: "second",
            severity: 1,
          }),
        ],
      ],
    ])

    await client.shutdown()
  })
})
