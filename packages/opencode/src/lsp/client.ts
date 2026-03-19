import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Path } from "@/path/path"
import type { FileURI, PathKey, PrettyPath } from "@/path/schema"
import path from "path"
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node"
import type { Diagnostic as VSCodeDiagnostic } from "vscode-languageserver-types"
import { Log } from "../util/log"
import { Process } from "../util/process"
import { LANGUAGE_EXTENSIONS } from "./language"
import z from "zod"
import type { LSPServer } from "./server"
import { NamedError } from "@opencode-ai/util/error"
import { withTimeout } from "../util/timeout"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"

const DIAGNOSTICS_DEBOUNCE_MS = 150

export namespace LSPClient {
  const log = Log.create({ service: "lsp.client" })

  type Entry = {
    path: PrettyPath
    diagnostics: Diagnostic[]
  }

  type Open = {
    path: PrettyPath
    version: number
  }

  export type Info = NonNullable<Awaited<ReturnType<typeof create>>>

  export type Diagnostic = VSCodeDiagnostic

  export const InitializeError = NamedError.create(
    "LSPInitializeError",
    z.object({
      serverID: z.string(),
    }),
  )

  export const Event = {
    Diagnostics: BusEvent.define(
      "lsp.client.diagnostics",
      z.object({
        serverID: z.string(),
        path: z.string(),
        pathKey: z.string(),
      }),
    ),
  }

  export async function create(input: { serverID: string; server: LSPServer.Handle; root: PrettyPath | string }) {
    const l = log.clone().tag("serverID", input.serverID)
    l.info("starting client")
    const root = Path.pretty(input.root, { cwd: Instance.directory })

    const connection = createMessageConnection(
      new StreamMessageReader(input.server.process.stdout as any),
      new StreamMessageWriter(input.server.process.stdin as any),
    )

    const diagnostics = new Map<PathKey, Entry>()
    connection.onNotification("textDocument/publishDiagnostics", (params) => {
      const path = Path.fromURI(params.uri)
      const pathKey = Path.key(path)
      const filePath = diagnostics.get(pathKey)?.path ?? files.get(pathKey)?.path ?? path
      l.info("textDocument/publishDiagnostics", {
        path: filePath,
        count: params.diagnostics.length,
      })
      const exists = diagnostics.has(pathKey)
      diagnostics.set(pathKey, { path: filePath, diagnostics: params.diagnostics })
      if (!exists && input.serverID === "typescript") return
      Bus.publish(Event.Diagnostics, { path: filePath, pathKey, serverID: input.serverID })
    })
    connection.onRequest("window/workDoneProgress/create", (params) => {
      l.info("window/workDoneProgress/create", params)
      return null
    })
    connection.onRequest("workspace/configuration", async () => {
      // Return server initialization options
      return [input.server.initialization ?? {}]
    })
    connection.onRequest("client/registerCapability", async () => {})
    connection.onRequest("client/unregisterCapability", async () => {})
    connection.onRequest("workspace/workspaceFolders", async () => [
      {
        name: "workspace",
        uri: String(Path.uri(root)),
      },
    ])
    connection.listen()

    l.info("sending initialize")
    await withTimeout(
      connection.sendRequest("initialize", {
        rootUri: String(Path.uri(root)),
        processId: input.server.process.pid,
        workspaceFolders: [
          {
            name: "workspace",
            uri: String(Path.uri(root)),
          },
        ],
        initializationOptions: {
          ...input.server.initialization,
        },
        capabilities: {
          window: {
            workDoneProgress: true,
          },
          workspace: {
            configuration: true,
            didChangeWatchedFiles: {
              dynamicRegistration: true,
            },
          },
          textDocument: {
            synchronization: {
              didOpen: true,
              didChange: true,
            },
            publishDiagnostics: {
              versionSupport: true,
            },
          },
        },
      }),
      45_000,
    ).catch((err) => {
      l.error("initialize error", { error: err })
      throw new InitializeError(
        { serverID: input.serverID },
        {
          cause: err,
        },
      )
    })

    await connection.sendNotification("initialized", {})

    if (input.server.initialization) {
      await connection.sendNotification("workspace/didChangeConfiguration", {
        settings: input.server.initialization,
      })
    }

    const files = new Map<PathKey, Open>()

    const result = {
      root,
      rootKey: Path.key(root),
      get serverID() {
        return input.serverID
      },
      get connection() {
        return connection
      },
      notify: {
        async open(input: { path: PrettyPath | string }) {
          const file = Path.pretty(input.path, { cwd: Instance.directory })
          const pathKey = Path.key(file)
          const doc = files.get(pathKey)
          const text = await Filesystem.readText(file)
          const extension = path.extname(file)
          const languageId = LANGUAGE_EXTENSIONS[extension] ?? "plaintext"
          const open = doc?.path ?? file
          const uri: FileURI = Path.uri(open)

          if (doc) {
            log.info("workspace/didChangeWatchedFiles", { path: open })
            await connection.sendNotification("workspace/didChangeWatchedFiles", {
              changes: [
                {
                  uri,
                  type: 2, // Changed
                },
              ],
            })

            const next = doc.version + 1
            files.set(pathKey, { path: open, version: next })
            log.info("textDocument/didChange", {
              path: open,
              version: next,
            })
            await connection.sendNotification("textDocument/didChange", {
              textDocument: {
                uri,
                version: next,
              },
              contentChanges: [{ text }],
            })
            return
          }

          log.info("workspace/didChangeWatchedFiles", { path: open })
          await connection.sendNotification("workspace/didChangeWatchedFiles", {
            changes: [
              {
                uri,
                type: 1, // Created
              },
            ],
          })

          log.info("textDocument/didOpen", { path: open })
          diagnostics.delete(pathKey)
          await connection.sendNotification("textDocument/didOpen", {
            textDocument: {
              uri,
              languageId,
              version: 0,
              text,
            },
          })
          files.set(pathKey, { path: open, version: 0 })
          return
        },
      },
      get diagnostics() {
        return new Map([...diagnostics.values()].map((item) => [String(item.path), item.diagnostics]))
      },
      async waitForDiagnostics(input: { path: PrettyPath | string }) {
        const path = Path.pretty(input.path, { cwd: Instance.directory })
        const pathKey = Path.key(path)
        log.info("waiting for diagnostics", { path })
        let unsub: () => void
        let debounceTimer: ReturnType<typeof setTimeout> | undefined
        return await withTimeout(
          new Promise<void>((resolve) => {
            unsub = Bus.subscribe(Event.Diagnostics, (event) => {
              if (event.properties.pathKey === pathKey && event.properties.serverID === result.serverID) {
                // Debounce to allow LSP to send follow-up diagnostics (e.g., semantic after syntax)
                if (debounceTimer) clearTimeout(debounceTimer)
                debounceTimer = setTimeout(() => {
                  log.info("got diagnostics", { path })
                  unsub?.()
                  resolve()
                }, DIAGNOSTICS_DEBOUNCE_MS)
              }
            })
          }),
          3000,
        )
          .catch(() => {})
          .finally(() => {
            if (debounceTimer) clearTimeout(debounceTimer)
            unsub?.()
          })
      },
      async shutdown() {
        l.info("shutting down")
        connection.end()
        connection.dispose()
        await Process.stop(input.server.process)
        l.info("shutdown")
      },
    }

    l.info("initialized")

    return result
  }
}
