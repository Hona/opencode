import { beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../fixture/fixture"
import { LSPClient } from "../../src/lsp"
import { LSPServer } from "../../src/lsp"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util"

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
          root: process.cwd(),
          directory: process.cwd(),
        }),
    })

    await client.connection.sendNotification("test/trigger", {
      method: "workspace/workspaceFolders",
    })

    await new Promise((resolve) => setTimeout(resolve, 100))
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
          root: process.cwd(),
          directory: process.cwd(),
        }),
    })

    await client.connection.sendNotification("test/trigger", {
      method: "client/registerCapability",
    })

    await new Promise((resolve) => setTimeout(resolve, 100))
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
          root: process.cwd(),
          directory: process.cwd(),
        }),
    })

    await client.connection.sendNotification("test/trigger", {
      method: "client/unregisterCapability",
    })

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(client.connection).toBeDefined()
    await client.shutdown()
  })

  test("sends ranged didChange for incremental sync servers", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "client.ts")
    await Bun.write(file, "first\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
        })

        await client.notify.open({ path: file })
        await Bun.write(file, "second\nthird\n")
        await client.notify.open({ path: file })

        const change = await client.connection.sendRequest<{
          textDocument: { version: number }
          contentChanges: {
            range?: { start: { line: number; character: number }; end: { line: number; character: number } }
            text: string
          }[]
        }>("test/get-last-change", {})
        expect(change.textDocument.version).toBe(1)
        expect(change.contentChanges).toEqual([
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 1, character: 0 },
            },
            text: "second\nthird\n",
          },
        ])

        await client.shutdown()
      },
    })
  })

  test("document mode falls back to push diagnostics", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "client.ts")
    await Bun.write(file, "const x = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
        })

        const version = await client.notify.open({ path: file })
        const wait = client.waitForDiagnostics({ path: file, version, mode: "document" })
        await client.connection.sendNotification("test/publish-diagnostics", {
          uri: pathToFileURL(file).href,
          version,
          diagnostics: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 5 },
              },
              message: "push diagnostic",
              severity: 1,
            },
          ],
        })
        await wait

        const diagnostics = client.diagnostics.get(file) ?? []
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]?.message).toBe("push diagnostic")

        const count = await client.connection.sendRequest("test/get-diagnostic-request-count", {})
        expect(count).toBe(0)

        await client.shutdown()
      },
    })
  })

  test("document mode waits for pull diagnostics", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "client.cs")
    await Bun.write(file, "class C {}\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
        })

        await client.connection.sendRequest("test/configure-pull-diagnostics", {
          registerOn: "didOpen",
          registrations: [{ identifier: "DocumentCompilerSemantic" }],
          documentDiagnosticsByIdentifier: {
            DocumentCompilerSemantic: [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 5 },
                },
                message: "pull diagnostic",
                severity: 1,
              },
            ],
          },
        })

        const version = await client.notify.open({ path: file })
        await client.waitForDiagnostics({ path: file, version, mode: "document" })

        const diagnostics = client.diagnostics.get(file) ?? []
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]?.message).toBe("pull diagnostic")

        const count = await client.connection.sendRequest("test/get-diagnostic-request-count", {})
        expect(count).toBeGreaterThan(0)

        await client.shutdown()
      },
    })
  })

  test("document mode issues identifier pulls in parallel without settle delay", async () => {
    // Guards against two latency regressions:
    //   1. Sequentially sweeping identifier pulls (would be ~5 * 300ms = 1500ms).
    //   2. Re-introducing a settle/debounce wait after a matching pull response.
    // Parallel dispatch completes in ~300ms; threshold leaves headroom for CI jitter.
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "client.cs")
    await Bun.write(file, "class C {}\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
        })

        const identifiers = ["syntax", "compiler", "analyzer-semantic", "analyzer-syntax", "non-local"]
        await client.connection.sendRequest("test/configure-pull-diagnostics", {
          registerOn: "didOpen",
          delayMs: 300,
          registrations: identifiers.map((identifier) => ({ identifier })),
          documentDiagnosticsByIdentifier: Object.fromEntries(
            identifiers.map((identifier) => [
              identifier,
              [
                {
                  range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 5 },
                  },
                  message: `from ${identifier}`,
                  severity: 1,
                },
              ],
            ]),
          ),
        })

        const version = await client.notify.open({ path: file })
        const started = Date.now()
        await client.waitForDiagnostics({ path: file, version, mode: "document" })
        const duration = Date.now() - started

        expect(duration).toBeLessThan(1000)
        expect(client.diagnostics.get(file)?.length ?? 0).toBeGreaterThan(0)

        await client.shutdown()
      },
    })
  })

  test("full mode includes workspace pull diagnostics", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "client.cs")
    const related = path.join(tmp.path, "other.cs")
    await Bun.write(file, "class C {}\n")
    await Bun.write(related, "class D {}\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
        })

        await client.connection.sendRequest("test/configure-pull-diagnostics", {
          registerOn: "didOpen",
          registrations: [
            { identifier: "DocumentCompilerSemantic" },
            { identifier: "WorkspaceDocumentsAndProject", workspaceDiagnostics: true },
          ],
          documentDiagnosticsByIdentifier: {
            DocumentCompilerSemantic: [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 5 },
                },
                message: "current file",
                severity: 1,
              },
            ],
          },
          workspaceDiagnosticsByIdentifier: {
            WorkspaceDocumentsAndProject: [
              {
                uri: pathToFileURL(related).href,
                items: [
                  {
                    range: {
                      start: { line: 0, character: 0 },
                      end: { line: 0, character: 5 },
                    },
                    message: "workspace file",
                    severity: 1,
                  },
                ],
              },
            ],
          },
        })

        const version = await client.notify.open({ path: file })
        await client.waitForDiagnostics({ path: file, version, mode: "full" })

        expect(client.diagnostics.get(file)?.[0]?.message).toBe("current file")
        expect(client.diagnostics.get(related)?.[0]?.message).toBe("workspace file")

        await client.shutdown()
      },
    })
  })
})
