export * as ServerProcess from "./server-process"

import { NodeServices } from "@effect/platform-node"
import { Service, type DiscoverOptions } from "@opencode/client/effect/service"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { OPENCODE_ARTIFACT, OPENCODE_CHANNEL, OPENCODE_VERSION } from "./version"
import { AppProcess } from "@opencode/util/process"
import { randomBytes, randomUUID } from "node:crypto"
import { connect } from "node:net"
import { Effect, Option, Redacted, Result, Schedule, Schema } from "effect"
import { PersistentPty } from "@opencode/schema/persistent-pty"
import { HttpServer, HttpServerError } from "effect/unstable/http"
import { Env } from "./env"
import { ServiceConfig } from "./services/service-config"
import { RetainedImage } from "./services/retained-image"
import { ServiceRegistration } from "./services/service-registration"
import { WebUi } from "./services/web-ui"
import { WslPorts } from "./services/wsl-ports"
import { databasePath } from "./database-path"

export type Mode = "default" | "service" | "stdio"

export type Options = {
  readonly mode: Mode
  readonly hostname?: string
  readonly port?: number
  readonly cors?: readonly string[]
}

// The process effect lives until server shutdown; tracing it would parent every request to one process-lifetime trace.
export const run = Effect.fnUntraced(function* (options: Options) {
  return yield* processEffect(options).pipe(
    Effect.provide(
      LayerNode.compile(LayerNode.group([Global.node, AppProcess.node]), {
        replacements: [
          Global.node.replace(
            Global.layerWith(process.env.OPENCODE_CONFIG_DIR ? { config: process.env.OPENCODE_CONFIG_DIR } : {}),
          ),
        ],
      }),
    ),
    Effect.provide(NodeServices.layer),
  )
})

const processEffect = Effect.fnUntraced(function* (options: Options) {
  const inherited = process.env.OPENCODE_PTY_HANDOFF
  delete process.env.OPENCODE_PTY_HANDOFF
  const handoff =
    inherited === undefined
      ? undefined
      : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PersistentPty.Handoff))(inherited).pipe(
          Effect.mapError(() => new Error("Invalid PTY restart handoff")),
        )
  const global = yield* Global.Service
  if (options.mode === "service") yield* Effect.sync(() => process.chdir(global.home))
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const foreground = options.mode === "default"
      const serviceOptions = options.mode === "service" ? yield* ServiceConfig.options() : undefined
      const config = options.mode === "service" ? yield* ServiceConfig.read() : {}
      const hostname = options.hostname ?? config.hostname ?? "127.0.0.1"
      const port = options.port ?? config.port ?? (options.mode === "service" ? ServiceConfig.defaultPort() : undefined)
      const incumbent =
        serviceOptions !== undefined && port !== undefined
          ? yield* Service.incumbent({ ...serviceOptions, url: serviceURL(hostname, port) })
          : undefined
      if (incumbent !== undefined) return
      // Keep a package-manager or curl install replaceable while the service runs; Desktop updates its own copy.
      if (options.mode === "service" && process.platform === "win32" && RetainedImage.installed(global.home))
        yield* RetainedImage.retain(global.cache, "service")
      const { start } = yield* Effect.promise(() => import("@opencode/server/process"))
      const environmentPassword = yield* Env.password
      // Keep the lease credential out of the environment inherited by tools.
      if (options.mode === "stdio") {
        delete process.env.OPENCODE_PASSWORD
        delete process.env.OPENCODE_SERVER_PASSWORD
      }
      const password =
        options.mode === "service"
          ? config.password || randomBytes(32).toString("base64url")
          : environmentPassword
            ? Redacted.value(environmentPassword)
            : randomBytes(32).toString("base64url")
      if (!password) return yield* Effect.fail(new Error("Missing server password"))
      const instanceID = randomUUID()
      const transform = yield* WebUi.handler()
      const serverOptions = {
        app: {
          name: process.env.OPENCODE_CLIENT ?? OPENCODE_ARTIFACT,
          version: OPENCODE_VERSION,
          channel: OPENCODE_CHANNEL,
        },
        hostname,
        port,
        cors: options.cors ?? config.cors,
        password,
        pty: { handoff },
        simulation: truthy(process.env.OPENCODE_SIMULATE),
        database: {
          path: databasePath(global.data),
        },
        models: {
          url: process.env.OPENCODE_MODELS_URL,
          file: process.env.OPENCODE_MODELS_PATH,
          fetch: !truthy(process.env.OPENCODE_DISABLE_MODELS_FETCH),
        },
        config: {
          directory: process.env.OPENCODE_CONFIG_DIR,
          project: !truthy(process.env.OPENCODE_CONFIG_PROJECT_DISABLE ?? process.env.OPENCODE_DISABLE_PROJECT_CONFIG),
          file: process.env.OPENCODE_CONFIG,
          content: process.env.OPENCODE_CONFIG_CONTENT,
        },
        windows: {
          gitbash: process.env.OPENCODE_GIT_BASH_PATH,
        },
        fs: {
          filewatcher: !truthy(process.env.OPENCODE_FILEWATCHER_DISABLE ?? process.env.OPENCODE_DISABLE_FILEWATCHER),
          fff:
            process.env.OPENCODE_DISABLE_FFF === undefined
              ? process.platform !== "win32"
              : !truthy(process.env.OPENCODE_DISABLE_FFF),
        },
      }
      const lifecycle =
        serviceOptions === undefined
          ? undefined
          : {
              onListen: (address: HttpServer.Address, shutdown: Effect.Effect<void>) =>
                Effect.gen(function* () {
                  if (!config.password) yield* ServiceConfig.password(password)
                  return yield* ServiceRegistration.register({
                    address,
                    password,
                    id: instanceID,
                    file: serviceOptions.file,
                    shutdown,
                  })
                }),
            }
      const server = yield* serviceOptions === undefined || port === undefined
        ? start(serverOptions, lifecycle, transform)
        : claimServicePort({
            options: serviceOptions,
            hostname,
            port,
            // A configured port is part of the user's setup (remote access, firewall rules); only the default moves.
            movable: options.port === undefined && config.port === undefined,
            claim: (candidate) => start({ ...serverOptions, port: candidate }, lifecycle, transform),
          })
      if (server === undefined) return
      const url = HttpServer.formatAddress(server.address)
      console.log(options.mode === "stdio" ? JSON.stringify({ url }) : `server listening on ${url}`)
      if (foreground && !environmentPassword) console.log(`server password ${password}`)
      return yield* options.mode === "service"
        ? server.shutdown
        : options.mode === "stdio"
          ? waitForStdinClose()
          : Effect.never
    }).pipe(Effect.annotateLogs({ role: "server" })),
  )
})

// The service port is the lock that keeps two services off one database: a contender that cannot bind
// it waits for the sibling holding it to register, then exits. Some ports are held where no sibling can
// be: reserved by the OS (Bun reports Hyper-V excluded ranges as EADDRINUSE), a stale WSL forward, or a
// running WSL distro's listener. Every contender skips those in the same order, so contenders still
// meet at the first port that can actually be bound.
const claimServicePort = Effect.fnUntraced(function* <A, E, R>(input: {
  readonly options: DiscoverOptions
  readonly hostname: string
  readonly port: number
  readonly movable: boolean
  readonly claim: (port: number) => Effect.Effect<A, E, R>
}) {
  const wsl = yield* Effect.cached(WslPorts.listening())
  for (let port = input.port; port <= 65_535; port++) {
    const result = yield* Effect.result(input.claim(port))
    if (Result.isSuccess(result)) {
      if (port !== input.port)
        yield* Effect.logWarning("managed service port unavailable; using the next free port", {
          hostname: input.hostname,
          preferred: input.port,
          port,
        })
      return result.success
    }
    if (!bindConflict(result.failure)) return yield* Effect.fail(result.failure)
    const foreign = (yield* unanswered(input.hostname, port)) || (yield* wsl).includes(port)
    if (!foreign && (yield* recognizeIncumbent(input.options, input.hostname, port))) return undefined
    if (!input.movable)
      return yield* Effect.fail(
        new Error(
          `Managed service port ${port} on ${input.hostname} is already in use or reserved by another process. ` +
            "Configure another port with `opencode service set port <port>` and start the service again.",
          { cause: result.failure },
        ),
      )
  }
  return yield* Effect.fail(new Error(`No free managed service port on ${input.hostname} from ${input.port}`))
})

const recognizeIncumbent = Effect.fnUntraced(function* (options: DiscoverOptions, hostname: string, port: number) {
  const found = yield* Service.incumbent({ ...options, url: serviceURL(hostname, port) }).pipe(
    Effect.filterOrFail((value) => value !== undefined),
    Effect.retry(Schedule.spaced("100 millis")),
    Effect.timeoutOption("15 seconds"),
  )
  return Option.isSome(found)
})

function serviceURL(hostname: string, port: number) {
  return `http://${hostname.includes(":") ? `[${hostname}]` : hostname}:${port}`
}

function truthy(value?: string) {
  return value === "1" || value?.toLowerCase() === "true"
}

// Node reports EACCES for Windows excluded ranges and exclusive wildcard listeners; Bun reports EADDRINUSE.
function bindConflict(error: unknown) {
  if (!(error instanceof HttpServerError.ServeError)) return false
  const code =
    typeof error.cause === "object" && error.cause !== null && "code" in error.cause ? error.cause.code : undefined
  return code === "EADDRINUSE" || code === "EACCES"
}

// A sibling answers HTTP as soon as it binds. A reserved port refuses the connection, and a stale WSL
// forward accepts it then closes without answering; neither can be a sibling. Silence is not proof, so
// a listener too busy to answer still counts as a possible sibling.
function unanswered(hostname: string, port: number) {
  return Effect.callback<boolean>((resume) => {
    const host = hostname === "0.0.0.0" ? "127.0.0.1" : hostname === "::" ? "::1" : hostname
    const socket = connect({ host, port })
    const settle = (value: boolean) => {
      socket.removeAllListeners().destroy()
      resume(Effect.succeed(value))
    }
    socket.setTimeout(1_000, () => settle(false))
    socket.once("connect", () => socket.write(`GET /api/info HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`))
    socket.once("data", () => settle(false))
    socket.once("error", () => settle(true))
    socket.once("close", () => settle(true))
    return Effect.sync(() => socket.destroy())
  })
}

function waitForStdinClose() {
  return Effect.callback<void>((resume) => {
    const close = () => resume(Effect.void)
    process.stdin.once("end", close)
    process.stdin.once("close", close)
    process.stdin.resume()
    if (process.stdin.readableEnded || process.stdin.destroyed) close()
    return Effect.sync(() => {
      process.stdin.off("end", close)
      process.stdin.off("close", close)
      process.stdin.pause()
    })
  })
}
