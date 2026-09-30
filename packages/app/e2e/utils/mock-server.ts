import type { Page } from "@playwright/test"
import type { JsonValue, OpenCodeEvent, SessionMessageInfo } from "@opencode/client/promise"
import { Duration, Effect, Layer } from "effect"
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { SERVER } from "./app"
import { MockApi, MockBadRequest, MockInternal, MockNotFound, MockUnsupported } from "./mock-api"
import { installSseTransport } from "./sse-transport"

type Resolvable<T> = T | (() => T)

export interface MockServerConfig {
  server?: string
  provider: unknown | (() => unknown)
  integrations?: unknown[]
  onConnectKey?: (input: { integrationID: string; body: unknown }) => void
  shells?: unknown[]
  configEntries?: unknown[]
  directory: string
  project: unknown
  // Replaces the `/api/project` inventory, which defaults to `[project]`.
  projects?: Resolvable<unknown[]>
  sessions: ({ id: string } & Record<string, unknown>)[]
  pageMessages: (
    sessionId: string,
    limit: number,
    before?: string,
  ) => {
    items: SessionMessageInfo[]
    cursor?: string
  }
  vcs?: { current: string; default: string }
  vcsDiff?: unknown[] | ((input: { mode?: string }) => unknown[])
  // Benchmark latency only. Tests hold message pages with `beforeMessagesResponse`.
  messageDelay?: number
  beforeMessagesResponse?: (input: { sessionID: string; before?: string }) => Promise<void>
  onMessages?: (input: { sessionID: string; before?: string; phase: "start" | "end" }) => void
  message?: (sessionID: string, messageID: string) => SessionMessageInfo | undefined
  onMessage?: (input: { sessionID: string; messageID: string }) => void
  onRevertStage?: (input: { sessionID: string; messageID: string }) => void
  onSession?: (sessionID: string) => void
  events?: () => OpenCodeEvent[]
  eventRetry?: number
  // Idle event streams send a comment every 15 s like the real server. Set false only to test the client's stall watchdog.
  keepalive?: boolean
  permissions?: unknown[] | (() => unknown[])
  // Requests only listed by `/api/session/:id/permission`, keyed by session ID.
  sessionPermissions?: Record<string, unknown[]>
  // Returning true fails the next `/api/permission/request` listing with a 500.
  permissionListFailures?: () => boolean
  // Without it, permission replies answer 501 MockUnsupported.
  onPermissionReply?: (input: { sessionID: string; permissionID: string; body: unknown }) => void
  forms?: unknown[] | (() => unknown[])
  mcp?: Resolvable<unknown[]>
  plugins?: Resolvable<unknown[]>
  skills?: Resolvable<unknown[]>
  // Replaces the `/api/worktree` inventory, which defaults to the directory plus project sandboxes.
  worktrees?: Resolvable<unknown[]>
  // Without them, creating or removing a worktree answers 501 MockUnsupported.
  onWorktreeCreate?: (input: unknown) => void | Promise<void>
  onWorktreeRemove?: (input: unknown) => void | Promise<void>
  fileList?: (path: string) => unknown | Promise<unknown>
  fileContent?: (path: string) => unknown | Promise<unknown>
  findFiles?: (input: { query: string; dirs?: string; limit?: number }) => unknown
  sessionStatus?: Record<string, unknown> | (() => Record<string, unknown>)
  inbox?: unknown[] | (() => unknown[])
  onPrompt?: (input: { sessionID: string; body: Record<string, unknown> }) => void
  generate?: (input: { sessionID: string; prompt: string }) => { text: string } | Promise<{ text: string }>
  onInboxChange?: (input: { sessionID: string; inboxID: string; action: "cancel" | "steer" | "queue" }) => void
  // Serves `/api/pty*` and mock PTY WebSockets. Created IDs are the first unused `${prefix}<n>` (prefix must start with "pty").
  pty?: { prefix?: string; initial?: { id: string; title: string; directory?: string }[] }
  // Answers 500 InvalidDirectory when a request names a directory this server does not own.
  strictDirectory?: boolean
}

export type MockPtyInfo = {
  id: string
  title: string
  command: string
  args: string[]
  cwd: string
  status: "running" | "exited"
  pid: number
}

export type MockPtySocket = { id: string; url: URL; input: string[]; closed: boolean; send(data: string): void }

export type MockPty = {
  list: MockPtyInfo[]
  created: MockPtyInfo[]
  removed: string[]
  updates: { id: string; body: unknown }[]
  tokens: { id: string; headers: Record<string, string> }[]
  sockets: MockPtySocket[]
  // WebSockets closed with 1008 because the PTY, its workspace, or an unused issued ticket did not match.
  rejected: { id: string; url: URL; reason: string }[]
  // Writes output to the newest open socket, optionally for one PTY.
  send(data: string, id?: string): void
}

type MockStream = { push: (payloads: unknown[]) => void }

type MockStreamWindow = Window & {
  // Set to any value by benchmarks that bring their own event stream.
  __testSseTransport?: unknown
  __testSseTransports?: Record<string, unknown>
  __mockServerStreams?: Record<string, MockStream>
  // The first installed stream, kept for specs that push to it directly.
  __mockServerStream?: MockStream
}

export async function mockOpenCodeServer(page: Page, config: MockServerConfig) {
  const server = config.server ?? SERVER

  mockedOrigins(page).add(server)

  await page.addInitScript(
    ({ server, retry, keepalive: idle }) => {
      const host = window as MockStreamWindow
      if (host.__testSseTransport || host.__testSseTransports?.[server] || host.__mockServerStreams?.[server]) return
      const originalFetch = window.fetch.bind(window)
      const encoder = new TextEncoder()
      const state: {
        controller?: ReadableStreamDefaultController<Uint8Array>
        buffer: string[]
        connections: number
      } = { buffer: [], connections: 0 }
      const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
      const stream = {
        push(payloads: unknown[]) {
          const frames = payloads.map(frame)
          const controller = state.controller
          if (!controller) {
            state.buffer.push(...frames)
            return
          }
          frames.forEach((item) => controller.enqueue(encoder.encode(item)))
        },
      }
      host.__mockServerStreams = { ...host.__mockServerStreams, [server]: stream }
      host.__mockServerStream ??= stream
      const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        const url = new URL(request.url)
        if (url.origin !== server || url.pathname !== "/api/event") return originalFetch(request)
        state.connections += 1
        const id = state.connections
        let ended = false
        let own: ReadableStreamDefaultController<Uint8Array> | undefined
        let keepalive: ReturnType<typeof setInterval> | undefined
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            own = controller
            state.controller = controller
            if (retry !== undefined) controller.enqueue(encoder.encode(`retry: ${retry}\n\n`))
            controller.enqueue(
              encoder.encode(frame({ id: `evt_mock_connected_${id}`, type: "server.connected", data: {} })),
            )
            state.buffer.splice(0).forEach((item) => controller.enqueue(encoder.encode(item)))
            // Match the real server's idle stream so long scenarios do not
            // trigger the client's 45-second stall watchdog and reload history.
            if (idle) keepalive = setInterval(() => controller.enqueue(encoder.encode(": keepalive\n\n")), 15_000)
            request.signal.addEventListener(
              "abort",
              () => {
                if (ended) return
                ended = true
                clearInterval(keepalive)
                if (state.controller === controller) state.controller = undefined
                controller.error(request.signal.reason ?? new DOMException("The operation was aborted", "AbortError"))
              },
              { once: true },
            )
          },
          cancel() {
            if (ended) return
            ended = true
            clearInterval(keepalive)
            if (state.controller === own) state.controller = undefined
          },
        })
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "cache-control": "no-cache", "content-type": "text/event-stream" },
          }),
        )
      }
      Object.defineProperty(window, "fetch", { configurable: true, writable: true, value: fetch })
    },
    { server, retry: config.eventRetry, keepalive: config.keepalive !== false },
  )

  // Delivers events on this server's mock stream; buffered until the app connects.
  const push = (payloads: readonly OpenCodeEvent[]) =>
    page.evaluate(
      ({ server, payloads }) => {
        const stream = (window as MockStreamWindow).__mockServerStreams?.[server]
        if (!stream) throw new Error(`No mock event stream for ${server}; use its SSE transport instead`)
        stream.push(payloads)
      },
      { server, payloads: payloads as unknown[] },
    )

  if (config.events) {
    // Batches stay queued until the page accepts them; failures other than a missing document fail the test.
    const pump = { busy: false, pending: [] as OpenCodeEvent[] }
    const timer = setInterval(() => {
      if (pump.busy) return
      pump.pending.push(...(config.events?.() ?? []))
      if (pump.pending.length === 0) return
      pump.busy = true
      const batch = pump.pending.slice()
      void push(batch)
        .then(
          () => {
            pump.pending.splice(0, batch.length)
          },
          (error: unknown) => {
            if (page.isClosed()) return clearInterval(timer)
            if (retryableDelivery(error)) return
            clearInterval(timer)
            throw error
          },
        )
        .finally(() => {
          pump.busy = false
        })
    }, 50)
    page.on("close", () => clearInterval(timer))
  }
  const transport = createMockServerHandler(config)
  page.on("close", () => void transport.dispose())

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    if (!answers(page, server, url)) return route.fallback()
    // Production serves the UI and API from one origin; leave app assets to Vite.
    if (!url.pathname.startsWith("/api/")) return route.fallback()
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders })
    }
    const directory = url.searchParams.get("directory") ?? url.searchParams.get("location[directory]")
    if (config.strictDirectory && directory && !ownedDirectories(config).has(directory)) {
      return route.fulfill({ status: 500, headers: corsHeaders, json: { name: "InvalidDirectory" } })
    }

    const body = route.request().postDataBuffer()
    const response = await transport.handler(
      new Request(url, {
        method: route.request().method(),
        headers: route.request().headers(),
        body: body ? Uint8Array.from(body) : undefined,
      }),
    )
    if (response.status === 404 && url.origin !== server) return route.fallback()
    return route.fulfill({
      status: response.status,
      headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      body: Buffer.from(await response.arrayBuffer()),
    })
  })

  if (config.pty) {
    const host = new URL(server).host
    await page.routeWebSocket(
      (url) => url.host === host && /^\/api\/pty\/[^/]+\/connect$/.test(url.pathname),
      (ws) => {
        const url = new URL(ws.url())
        const id = decodeURIComponent(url.pathname.split("/")[3]!)
        const reason = transport.pty.admit(id, url)
        if (reason) {
          transport.pty.rejected.push({ id, url, reason })
          return ws.close({ code: 1008, reason })
        }
        const socket: MockPtySocket = {
          id,
          url,
          input: [],
          closed: false,
          send: (data) => ws.send(data),
        }
        ws.onMessage((message) => socket.input.push(message.toString()))
        ws.onClose(() => {
          socket.closed = true
        })
        transport.pty.sockets.push(socket)
      },
    )
  }

  return { server, pty: transport.pty, push }
}

// Mocks several servers on one page. Each origin gets its own handler and its own SSE transport for events.
export async function mockServers(page: Page, servers: Record<string, Omit<MockServerConfig, "server" | "events">>) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(servers).map(async ([origin, config]) => {
        const transport = await installSseTransport(page, {
          server: origin,
          retry: config.eventRetry,
          keepalive: config.keepalive,
        })
        const mock = await mockOpenCodeServer(page, { ...config, server: origin })
        return [origin, { transport, pty: mock.pty }] as const
      }),
    ),
  )
}

export function createMockServerHandler(config: MockServerConfig) {
  const pty = createPty(config)
  const web = HttpRouter.toWebHandler(
    HttpApiBuilder.layer(MockApi).pipe(
      Layer.provide(mockHandlers(config, { cursors: new Map<string, string>(), nextCursor: 0, pty })),
      Layer.provide(HttpServer.layerServices),
    ),
    { disableLogger: true },
  )
  return { ...web, pty }
}

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-expose-headers": "x-next-cursor",
}

const APP_ORIGIN = new URL(
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`,
).origin
const registeredOrigins = new WeakMap<Page, Set<string>>()

function mockedOrigins(page: Page) {
  const found = registeredOrigins.get(page)
  if (found) return found
  const created = new Set<string>()
  registeredOrigins.set(page, created)
  return created
}

// A server answers its own origin. Production builds call the API on the app origin, which the default server also
// answers unless a server was configured for the app origin explicitly.
function answers(page: Page, server: string, url: URL) {
  if (url.origin === server) return true
  return server === SERVER && url.origin === APP_ORIGIN && !mockedOrigins(page).has(APP_ORIGIN)
}

// The document is not loaded yet or is being replaced; the pump retries on its next tick.
function retryableDelivery(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return [
    "No mock event stream",
    "Execution context was destroyed",
    "Target page, context or browser has been closed",
  ].some((text) => message.includes(text))
}

const PTY_TICKET = "e2e-ticket"

function createPty(config: MockServerConfig) {
  const info = (id: string, title: string, cwd = config.directory): MockPtyInfo => ({
    id,
    title,
    command: "cmd.exe",
    args: [],
    cwd,
    status: "running",
    pid: 1,
  })
  // Issued, not yet used connect tickets.
  const tickets: { id: string; directory: string }[] = []
  const pty: MockPty = {
    list: (config.pty?.initial ?? []).map((item) => info(item.id, item.title, item.directory)),
    created: [],
    removed: [],
    updates: [],
    tokens: [],
    sockets: [],
    rejected: [],
    send(data, id) {
      const socket = pty.sockets.findLast((item) => !item.closed && (id === undefined || item.id === id))
      if (!socket) throw new Error(`No open PTY socket${id ? ` for ${id}` : ""}`)
      socket.send(data)
    },
  }
  return Object.assign(pty, {
    info,
    // The first `${prefix}<n>` no initial, created, or removed PTY has used.
    allocate() {
      const prefix = config.pty?.prefix ?? "pty_"
      const used = new Set([...pty.list, ...pty.created].map((item) => item.id).concat(pty.removed))
      const number = Array.from({ length: used.size + 1 }, (_, index) => index + 1).find(
        (value) => !used.has(`${prefix}${value}`),
      )!
      return { id: `${prefix}${number}`, number }
    },
    issue(id: string, directory: string) {
      tickets.push({ id, directory })
      return PTY_TICKET
    },
    // Returns why a connect URL is refused: the PTY must exist, belong to the requested workspace, and carry an unused issued ticket.
    admit(id: string, url: URL) {
      const found = pty.list.find((item) => item.id === id)
      if (!found) return "PTY not found"
      const directory = url.searchParams.get("location[directory]") ?? config.directory
      if (directory !== found.cwd) return "PTY belongs to another workspace"
      const index = tickets.findIndex((ticket) => ticket.id === id && ticket.directory === directory)
      if (url.searchParams.get("ticket") !== PTY_TICKET || index < 0) return "No unused ticket was issued for this PTY"
      tickets.splice(index, 1)
    },
  })
}

// Every directory this server's configuration names: its own, project and inventory worktrees, and session locations.
function ownedDirectories(config: MockServerConfig) {
  const projects = [config.project, ...(config.projects ? resolve(config.projects) : [])].filter(record)
  return new Set(
    [
      config.directory,
      ...projects.flatMap((item) => [
        item.worktree,
        item.canonical,
        ...(Array.isArray(item.sandboxes) ? item.sandboxes : []),
      ]),
      ...(config.worktrees ? resolve(config.worktrees) : []).filter(record).map((item) => item.directory),
      ...config.sessions.map((session) => (record(session.location) ? session.location.directory : session.directory)),
    ].filter((item): item is string => typeof item === "string"),
  )
}

function requestDirectory(config: MockServerConfig, request: { url: string }) {
  return new URL(request.url, "http://localhost").searchParams.get("location[directory]") ?? config.directory
}

function resolve<T>(value: Resolvable<T>) {
  return typeof value === "function" ? (value as () => T)() : value
}

function mockHandlers(
  config: MockServerConfig,
  state: { cursors: Map<string, string>; nextCursor: number; pty: ReturnType<typeof createPty> },
) {
  const noContent = Effect.succeed(HttpApiSchema.NoContent.make())
  const delay = config.messageDelay === undefined ? Effect.void : Effect.sleep(Duration.millis(config.messageDelay))
  const configEntries = config.configEntries ?? []
  const ptyEnabled = Effect.suspend(() =>
    config.pty ? Effect.void : Effect.fail(new MockNotFound({ message: "PTY is not enabled for this mock server" })),
  )
  // PTYs are scoped to the workspace (`location[directory]`) they were created in, like the real server.
  const findPty = (id: string, request: { url: string }) =>
    ptyEnabled.pipe(
      Effect.andThen(() =>
        Effect.suspend(() => {
          const directory = requestDirectory(config, request)
          const found = state.pty.list.find((item) => item.id === id && item.cwd === directory)
          return found ? Effect.succeed(found) : Effect.fail(new MockNotFound({ message: "PTY not found" }))
        }),
      ),
    )
  const unsupported = (operation: string, handler: string) =>
    Effect.fail(
      new MockUnsupported({ message: `The mock server does not ${operation}; configure ${handler} for this scenario` }),
    )
  return HttpApiBuilder.group(MockApi, "mock", (handlers) =>
    handlers
      .handleRaw("event", () => {
        const events = config.events?.()
        const retry = config.eventRetry === undefined ? "" : `retry: ${config.eventRetry}\n\n`
        const body = [{ id: "evt_mock_connected", type: "server.connected", data: {} }, ...(events ?? [])]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join("")
        return Effect.succeed(HttpServerResponse.text(retry + body, { contentType: "text/event-stream" }))
      })
      .handleRaw("fsRead", (ctx) =>
        Effect.gen(function* () {
          const path = decodeURIComponent(new URL(ctx.request.url, "http://localhost").pathname.slice(13))
          const value = yield* Effect.promise(() => Promise.resolve(config.fileContent?.(path)))
          const content =
            value && typeof value === "object" && "content" in value ? String(value.content) : String(value ?? "")
          return HttpServerResponse.uint8Array(new TextEncoder().encode(content))
        }),
      )
      .handleAll({
        info: () =>
          Effect.succeed({
            version: "2.0.0",
            pid: 1,
            urls: config.server ? [config.server] : [],
            paths: { tmp: "/tmp/opencode" },
          }),
        config: () => Effect.succeed(configEntries),
        reference: () =>
          Effect.succeed({
            location: {
              directory: config.directory,
              project: {
                id: (config.project as { id?: string }).id,
                directory: config.directory,
                canonical: config.directory,
              },
            },
            data: [],
          }),
        agent: () =>
          Effect.succeed({
            location: location(config),
            data: [
              {
                id: "build",
                name: "Build",
                mode: "primary",
                hidden: false,
                request: { settings: {}, headers: {}, body: {} },
                permissions: [],
              },
            ],
          }),
        provider: () => Effect.succeed({ location: location(config), data: currentProviders(providerConfig(config)) }),
        model: () => Effect.succeed({ location: location(config), data: currentModels(providerConfig(config)) }),
        modelDefault: () =>
          Effect.succeed({ location: location(config), data: currentDefaultModel(providerConfig(config)) }),
        integrationList: () => Effect.succeed({ location: location(config), data: config.integrations ?? [] }),
        integrationGet: (ctx) =>
          Effect.succeed({
            location: location(config),
            data: config.integrations
              ?.filter(record)
              .find((integration) => integration.id === ctx.params.integrationID) ?? {
              id: ctx.params.integrationID,
              name: ctx.params.integrationID,
              methods: [{ type: "key", label: "API key" }],
              connections: [],
            },
          }),
        integrationConnect: (ctx) =>
          Effect.sync(() => config.onConnectKey?.({ integrationID: ctx.params.integrationID, body: ctx.payload })).pipe(
            Effect.andThen(noContent),
          ),
        credentialRemove: () => noContent,
        command: () => Effect.succeed({ location: location(config), data: [] }),
        skill: () => Effect.sync(() => ({ location: location(config), data: resolve(config.skills ?? []) })),
        plugin: () => Effect.sync(() => ({ location: location(config), data: resolve(config.plugins ?? []) })),
        mcp: () => Effect.sync(() => ({ location: location(config), data: resolve(config.mcp ?? []) })),
        mcpResource: () => Effect.succeed({ location: location(config), data: { resources: [], templates: [] } }),
        projectList: () =>
          Effect.sync(() => {
            if (config.projects) return resolve(config.projects)
            const project = config.project as typeof config.project & { canonical?: string; worktree?: string }
            return [{ ...project, canonical: project.canonical ?? project.worktree ?? config.directory }]
          }),
        projectUpdate: (ctx) => {
          const project = config.project as { canonical?: string }
          return Effect.succeed({
            ...project,
            ...ctx.payload,
            id: ctx.params.projectID,
            canonical: project.canonical ?? config.directory,
          })
        },
        configShells: () => Effect.succeed(config.shells ?? []),
        configUpdate: () => noContent,
        websearchProviders: () => Effect.succeed({ location: location(config), data: [] }),
        worktreeList: () =>
          Effect.sync(() => {
            if (config.worktrees) return resolve(config.worktrees)
            return [
              { directory: config.directory },
              ...((config.project as { sandboxes?: string[] }).sandboxes ?? []).map((directory) => ({
                directory,
                strategy: "git",
              })),
            ]
          }),
        worktreeCreate: (ctx) => {
          const input = ctx.payload
          const create = config.onWorktreeCreate
          if (!create) return unsupported("create worktrees", "onWorktreeCreate")
          return Effect.promise(async () => {
            await create(input)
            return {
              directory: `${typeof input.directory === "string" ? input.directory : config.directory}/${
                typeof input.name === "string" ? input.name : "copy"
              }`,
            }
          })
        },
        worktreeRemove: (ctx) => {
          const remove = config.onWorktreeRemove
          if (!remove) return unsupported("remove worktrees", "onWorktreeRemove")
          return Effect.promise(async () => remove(ctx.payload)).pipe(Effect.andThen(noContent))
        },
        // Discovery against a static inventory changes nothing, and the app refreshes whenever worktree settings open.
        worktreeRefresh: () => noContent,
        location: () => Effect.succeed(location(config)),
        permissionRequests: () =>
          Effect.suspend(() =>
            config.permissionListFailures?.()
              ? Effect.fail(new MockInternal({ message: "Permission list failed" }))
              : Effect.succeed({
                  location: location(config),
                  data: (typeof config.permissions === "function"
                    ? config.permissions()
                    : (config.permissions ?? [])
                  ).map(currentPermission),
                }),
          ),
        formRequests: () =>
          Effect.succeed({
            location: location(config),
            data: typeof config.forms === "function" ? config.forms() : (config.forms ?? []),
          }),
        vcs: () =>
          Effect.succeed({
            location: location(config),
            data: { branch: config.vcs ?? { current: "main", default: "main" } },
          }),
        vcsStatus: () => Effect.succeed({ location: location(config), data: [] }),
        vcsBranches: () => Effect.succeed({ location: location(config), data: ["main"] }),
        vcsDiff: (ctx) =>
          Effect.sync(() => ({
            location: location(config),
            data:
              typeof config.vcsDiff === "function" ? config.vcsDiff({ mode: ctx.query.mode }) : (config.vcsDiff ?? []),
          })),
        fsList: (ctx) =>
          Effect.promise(() => Promise.resolve(config.fileList?.(ctx.query.path ?? ""))).pipe(
            Effect.map((data) => ({ location: location(config), data })),
          ),
        fsFind: (ctx) =>
          Effect.promise(() =>
            Promise.resolve(
              config.findFiles?.({ query: ctx.query.query ?? "", dirs: ctx.query.type, limit: ctx.query.limit }),
            ),
          ).pipe(
            Effect.map((entries) => ({
              location: location(config),
              data: Array.isArray(entries)
                ? entries.map((entry) =>
                    typeof entry === "string"
                      ? {
                          name: entry.split(/[\\/]/).at(-1) ?? entry,
                          path: entry,
                          absolute: `${config.directory}/${entry}`,
                          type: "directory",
                          ignored: false,
                        }
                      : entry,
                  )
                : entries,
            })),
          ),
        shell: () => Effect.succeed({ location: location(config), data: [] }),
        ptyList: (ctx) =>
          ptyEnabled.pipe(
            Effect.map(() => {
              const directory = requestDirectory(config, ctx.request)
              return { location: location(config), data: state.pty.list.filter((item) => item.cwd === directory) }
            }),
          ),
        ptyCreate: (ctx) =>
          ptyEnabled.pipe(
            Effect.map(() => {
              const next = state.pty.allocate()
              const created = state.pty.info(
                next.id,
                ctx.payload.title ?? `Terminal ${next.number}`,
                requestDirectory(config, ctx.request),
              )
              state.pty.created.push(created)
              state.pty.list.push(created)
              return { location: location(config), data: created }
            }),
          ),
        ptyGet: (ctx) =>
          findPty(ctx.params.ptyID, ctx.request).pipe(Effect.map((data) => ({ location: location(config), data }))),
        ptyUpdate: (ctx) =>
          findPty(ctx.params.ptyID, ctx.request).pipe(
            Effect.map((found) => {
              state.pty.updates.push({ id: found.id, body: ctx.payload })
              if (ctx.payload.title) found.title = ctx.payload.title
              return { location: location(config), data: found }
            }),
          ),
        ptyRemove: (ctx) =>
          findPty(ctx.params.ptyID, ctx.request).pipe(
            Effect.map((found) => {
              state.pty.removed.push(found.id)
              state.pty.list.splice(state.pty.list.indexOf(found), 1)
              return HttpApiSchema.NoContent.make()
            }),
          ),
        ptyConnectToken: (ctx) =>
          findPty(ctx.params.ptyID, ctx.request).pipe(
            Effect.map((found) => {
              state.pty.tokens.push({ id: found.id, headers: Object.fromEntries(Object.entries(ctx.request.headers)) })
              const ticket = state.pty.issue(found.id, found.cwd)
              return { location: location(config), data: { ticket, expires_in: 60 } }
            }),
          ),
        sessionList: (ctx) => {
          const sessions = config.sessions
            .filter((session) => {
              const location = session.location as { directory?: string } | undefined
              return (
                !ctx.query.directory ||
                location?.directory === ctx.query.directory ||
                session.directory === ctx.query.directory
              )
            })
            .filter((session) => {
              if (ctx.query.parentID === undefined) return true
              if (ctx.query.parentID === "null") return session.parentID === undefined
              return session.parentID === ctx.query.parentID
            })
            .filter((session) =>
              ctx.query.search === undefined
                ? true
                : String(session.title ?? "")
                    .toLowerCase()
                    .includes(ctx.query.search.toLowerCase()),
            )
          const ordered = ctx.query.order === "asc" ? sessions : sessions.toReversed()
          const offset = Number(ctx.query.cursor ?? 0)
          const limit = ctx.query.limit ?? 50
          const data = ordered.slice(offset, offset + limit)
          return Effect.succeed({
            data: data.map((session) => currentSession(session, config.directory)),
            cursor: { next: offset + limit < ordered.length ? String(offset + limit) : undefined },
          })
        },
        sessionCreate: (ctx) => {
          const payload = record(ctx.payload) ? ctx.payload : {}
          const created = currentSession(
            {
              id: "ses_mock_created",
              projectID: (config.project as { id?: string }).id,
              title: typeof payload.title === "string" ? payload.title : "New session",
              parentID: typeof payload.parentID === "string" ? payload.parentID : undefined,
            },
            config.directory,
          )
          return Effect.sync(() => config.sessions.push(created)).pipe(Effect.as({ data: created }))
        },
        sessionActive: () => {
          const statuses = (
            typeof config.sessionStatus === "function" ? config.sessionStatus() : (config.sessionStatus ?? {})
          ) as Record<string, { type?: string }>
          return Effect.succeed({
            data: Object.fromEntries(
              Object.entries(statuses).flatMap(([id, status]) =>
                status.type === "idle" ? [] : [[id, { type: "running" }]],
              ),
            ),
          })
        },
        sessionGet: (ctx) =>
          Effect.suspend(() => {
            config.onSession?.(ctx.params.sessionID)
            const session = config.sessions.find((item) => item.id === ctx.params.sessionID)
            return session
              ? Effect.succeed({ data: currentSession(session, config.directory) })
              : Effect.fail(new MockNotFound({ message: "Session not found" }))
          }),
        sessionRemove: () => noContent,
        sessionShell: () => noContent,
        sessionForm: (ctx) => {
          const forms = typeof config.forms === "function" ? config.forms() : (config.forms ?? [])
          return Effect.succeed({
            data: forms.filter((form) => (form as { sessionID?: string }).sessionID === ctx.params.sessionID),
          })
        },
        sessionFormReply: () => noContent,
        sessionFormCancel: () => noContent,
        sessionBackground: () => noContent,
        sessionInbox: () =>
          Effect.sync(() => ({ data: typeof config.inbox === "function" ? config.inbox() : (config.inbox ?? []) })),
        sessionPrompt: (ctx) =>
          Effect.sync(() => {
            const body = record(ctx.payload) ? ctx.payload : {}
            config.onPrompt?.({ sessionID: ctx.params.sessionID, body })
            return {
              data: {
                id: typeof body.id === "string" ? body.id : `inb_mock_${Date.now()}`,
                sessionID: ctx.params.sessionID,
                time: { created: Date.now() },
                type: "user",
                payload: {
                  text: typeof body.text === "string" ? body.text : "",
                  ...(body.files === undefined ? {} : { files: body.files }),
                  ...(body.agents === undefined ? {} : { agents: body.agents }),
                  ...(body.skills === undefined ? {} : { skills: body.skills }),
                  ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
                },
                delivery: body.delivery === "queue" ? "queue" : "steer",
              },
            }
          }),
        sessionGenerate: (ctx) =>
          Effect.promise(async () => ({
            data: (await config.generate?.({ sessionID: ctx.params.sessionID, prompt: ctx.payload.prompt })) ?? {
              text: "Side-question answer",
            },
          })),
        sessionInboxCancel: (ctx) =>
          Effect.sync(() =>
            config.onInboxChange?.({ sessionID: ctx.params.sessionID, inboxID: ctx.params.inboxID, action: "cancel" }),
          ).pipe(Effect.andThen(noContent)),
        sessionInboxUpdate: (ctx) =>
          Effect.sync(() =>
            config.onInboxChange?.({
              sessionID: ctx.params.sessionID,
              inboxID: ctx.params.inboxID,
              action: ctx.payload.delivery,
            }),
          ).pipe(Effect.andThen(noContent)),
        sessionSwitchAgent: () => noContent,
        sessionSwitchModel: () => noContent,
        sessionPermission: (ctx) => {
          const permissions =
            typeof config.permissions === "function" ? config.permissions() : (config.permissions ?? [])
          return Effect.succeed({
            data: [
              ...permissions
                .map(currentPermission)
                .filter((permission) => permission.sessionID === ctx.params.sessionID),
              ...(config.sessionPermissions?.[ctx.params.sessionID] ?? []).map(currentPermission),
            ],
          })
        },
        sessionPermissionReply: (ctx) => {
          const reply = config.onPermissionReply
          if (!reply) return unsupported("record permission replies", "onPermissionReply")
          return Effect.sync(() =>
            reply({ sessionID: ctx.params.sessionID, permissionID: ctx.params.permissionID, body: ctx.payload }),
          ).pipe(Effect.andThen(noContent))
        },
        sessionRename: () => noContent,
        sessionInterrupt: () => noContent,
        sessionRevertStage: (ctx) => {
          const payload = record(ctx.payload) ? ctx.payload : {}
          const messageID = payload.messageID
          if (typeof messageID !== "string") {
            return Effect.fail(new MockBadRequest({ message: "Invalid revert request" }))
          }
          return Effect.sync(() => config.onRevertStage?.({ sessionID: ctx.params.sessionID, messageID })).pipe(
            Effect.as({ data: { messageID } }),
          )
        },
        sessionRevertClear: () => noContent,
        sessionRevertCommit: () => noContent,
        messageGet: (ctx) =>
          Effect.gen(function* () {
            config.onMessage?.({ sessionID: ctx.params.sessionID, messageID: ctx.params.messageID })
            yield* delay
            const message =
              config.message?.(ctx.params.sessionID, ctx.params.messageID) ??
              config
                .pageMessages(ctx.params.sessionID, Number.MAX_SAFE_INTEGER)
                .items.find((item) => item.id === ctx.params.messageID)
            if (!message) return yield* new MockNotFound({ message: "Message not found" })
            return { data: message }
          }),
        messageList: (ctx) => {
          const token = ctx.query.cursor
          const before = token ? state.cursors.get(token) : undefined
          if (token && !before) return Effect.fail(new MockBadRequest({ message: "Invalid cursor" }))
          return Effect.gen(function* () {
            config.onMessages?.({ sessionID: ctx.params.sessionID, before, phase: "start" })
            if (config.beforeMessagesResponse) {
              yield* Effect.promise(() => config.beforeMessagesResponse!({ sessionID: ctx.params.sessionID, before }))
            }
            yield* delay
            const pageData = config.pageMessages(ctx.params.sessionID, ctx.query.limit ?? 50, before)
            config.onMessages?.({ sessionID: ctx.params.sessionID, before, phase: "end" })
            const cursor = pageData.cursor ? `cursor_${++state.nextCursor}` : undefined
            if (cursor) state.cursors.set(cursor, pageData.cursor!)
            return {
              data: ctx.query.order === "asc" ? pageData.items : pageData.items.toReversed(),
              cursor: { next: cursor },
            }
          })
        },
      }),
  )
}

function location(config: MockServerConfig) {
  return {
    directory: config.directory,
    project: { id: (config.project as { id?: string }).id, directory: config.directory, canonical: config.directory },
  }
}

function providerConfig(config: MockServerConfig) {
  return typeof config.provider === "function" ? config.provider() : config.provider
}

function currentProviders(value: unknown) {
  if (!record(value) || !Array.isArray(value.all)) return Array.isArray(value) ? value : []
  const connected = new Set(
    Array.isArray(value.connected) ? value.connected.filter((id) => typeof id === "string") : [],
  )
  return value.all.filter(record).flatMap((provider) =>
    typeof provider.id === "string" && typeof provider.name === "string"
      ? [
          {
            id: provider.id,
            name: provider.name,
            package: provider.id,
            activation: connected.has(provider.id) ? "enabled" : "auto",
          },
        ]
      : [],
  )
}

function currentModels(value: unknown) {
  if (!record(value) || !Array.isArray(value.all)) return []
  return value.all.filter(record).flatMap((provider) => {
    if (typeof provider.id !== "string" || !record(provider.models)) return []
    return Object.values(provider.models)
      .filter(record)
      .flatMap((model) => {
        if (typeof model.id !== "string" || typeof model.name !== "string") return []
        const limit = record(model.limit) ? model.limit : {}
        const cost = record(model.cost) ? model.cost : {}
        return [
          {
            id: model.id,
            modelID: record(model.api) && typeof model.api.id === "string" ? model.api.id : model.id,
            providerID: provider.id,
            name: model.name,
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            variants: record(model.variants)
              ? Object.entries(model.variants).map(([id, settings]) => ({
                  id,
                  ...(jsonRecord(settings) ? { settings: jsonRecord(settings) } : {}),
                }))
              : [],
            time: { released: Date.now() },
            cost: [
              {
                input: typeof cost.input === "number" ? cost.input : 0,
                output: typeof cost.output === "number" ? cost.output : 0,
                cache: { read: 0, write: 0 },
              },
            ],
            status: "active",
            enabled: true,
            limit: {
              context: typeof limit.context === "number" ? limit.context : 200_000,
              output: typeof limit.output === "number" ? limit.output : 32_000,
            },
          },
        ]
      })
  })
}

function currentDefaultModel(value: unknown) {
  if (!record(value) || !record(value.default)) return null
  const selected = value.default
  const models = currentModels(value)
  return models.find((model) => model.providerID === selected.providerID && model.id === selected.modelID) ?? null
}

function currentPermission(value: unknown) {
  const permission = value as Record<string, unknown>
  if (permission.action) return permission
  const tool = permission.tool as { messageID?: string; callID?: string; id?: string } | undefined
  return {
    id: permission.id,
    sessionID: permission.sessionID,
    action: permission.permission,
    resources: permission.patterns ?? [],
    save: permission.always,
    metadata: permission.metadata,
    source:
      tool?.messageID && (tool.id || tool.callID)
        ? { type: "tool", messageID: tool.messageID, id: tool.id ?? tool.callID }
        : undefined,
  }
}

export function currentSession(session: { id: string } & Record<string, unknown>, fallbackDirectory?: string) {
  const time = session.time && typeof session.time === "object" ? session.time : {}
  const location = session.location && typeof session.location === "object" ? session.location : {}
  return {
    id: session.id,
    parentID: session.parentID,
    projectID: session.projectID ?? "project",
    agent: session.agent ?? "build",
    model: session.model ?? { id: "mock-model", providerID: "mock-provider" },
    cost: session.cost ?? 0,
    tokens: session.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...(typeof session.outcome === "string" ? { outcome: session.outcome } : {}),
    time: {
      created: "created" in time && typeof time.created === "number" ? time.created : 0,
      updated: "updated" in time && typeof time.updated === "number" ? time.updated : 0,
      ...("idle" in time && typeof time.idle === "number" ? { idle: time.idle } : {}),
      ...("viewed" in time && typeof time.viewed === "number" ? { viewed: time.viewed } : {}),
      ...(session.time && typeof session.time === "object" && "archived" in session.time
        ? { archived: session.time.archived }
        : {}),
    },
    title: session.title ?? session.id,
    location: {
      directory:
        "directory" in location && typeof location.directory === "string"
          ? location.directory
          : typeof session.directory === "string"
            ? session.directory
            : fallbackDirectory,
    },
    subpath: session.subpath ?? session.path,
    revert: session.revert,
  }
}

function jsonRecord(value: unknown): Record<string, JsonValue> | undefined {
  if (!record(value)) return
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const next = jsonValue(item)
      return next === undefined ? [] : [[key, next]]
    }),
  )
}

function jsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.map((item) => jsonValue(item) ?? null)
  return jsonRecord(value)
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
