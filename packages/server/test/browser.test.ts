import { NodeSocket } from "@effect/platform-node"
import { Browser } from "@opencode-ai/schema/browser"
import { BrowserControl } from "@opencode-ai/schema/browser-control"
import { BrowserTunnel } from "@opencode-ai/schema/browser-tunnel"
import { Session } from "@opencode-ai/schema/session"
import { BrowserControlProtocol } from "@opencode-ai/protocol/browser-control"
import { BrowserTunnelProtocol } from "@opencode-ai/protocol/browser-tunnel"
import { expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Queue, Scope } from "effect"
import { TestConsole } from "effect/testing"
import { HttpServer } from "effect/unstable/http"
import { randomBytes } from "node:crypto"
import { request } from "node:http"
import { createServer } from "node:net"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"

const authorization = `Basic ${Buffer.from("opencode:secret").toString("base64")}`
const receiveWindowBytes = 256 * 1_024
const receiveWindowFrames = 16
const controlFrameType = 1
const encodeControl = BrowserControlProtocol.encodeFromDesktop
const decodeControl = (input: string | Uint8Array) => Effect.runSync(BrowserControlProtocol.decodeFromServer(input))

const startServer = Effect.fn("BrowserServerTest.startServer")(function* () {
  const server = yield* ServerProcess.start<never, never>({
    hostname: "127.0.0.1",
    port: 0,
    password: "secret",
    app: { version: "test-version" },
    database: { path: ":memory:" },
  })
  const url = new URL(HttpServer.formatAddress(server.address))
  url.protocol = "ws:"
  return url
})

const open = Effect.fn("BrowserServerTest.open")(function* (
  url: URL,
  protocol: string,
  headers: Record<string, string> = { authorization },
) {
  const messages = yield* Queue.unbounded<{ readonly data: string | Uint8Array; readonly binary: boolean }, Error>()
  const closed = yield* Deferred.make<{ readonly code: number; readonly reason: string }>()
  const webSocket = yield* Effect.acquireRelease(
    Effect.callback<NodeSocket.NodeWS.WebSocket, Error>((resume) => {
      const webSocket = new NodeSocket.NodeWS.WebSocket(url, protocol, { headers })
      webSocket.on("message", (data, binary) =>
        Queue.offerUnsafe(messages, { data: binary ? bytes(data) : Buffer.from(bytes(data)).toString(), binary }),
      )
      webSocket.once("close", (code, reason) =>
        Deferred.doneUnsafe(closed, Effect.succeed({ code, reason: reason.toString() })),
      )
      const onOpen = () => {
        webSocket.off("error", onError)
        resume(Effect.succeed(webSocket))
      }
      const onError = (error: Error) => {
        webSocket.off("open", onOpen)
        resume(Effect.fail(error))
      }
      webSocket.once("open", onOpen)
      webSocket.once("error", onError)
      return Effect.sync(() => webSocket.terminate())
    }),
    (webSocket) => Effect.sync(() => webSocket.terminate()),
  )
  return { webSocket, messages, closed }
})

const upgradeStatus = (url: URL, protocol: string, headers: Record<string, string> = { authorization }) =>
  Effect.callback<number, Error>((resume) => {
    const target = new URL(url)
    target.protocol = "http:"
    const upgrade = request(target, {
      headers: {
        ...headers,
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-key": randomBytes(16).toString("base64"),
        "sec-websocket-protocol": protocol,
        "sec-websocket-version": "13",
      },
    })
    upgrade.once("response", (response) => {
      resume(Effect.succeed(response.statusCode ?? 0))
      response.destroy()
    })
    upgrade.once("upgrade", (response, socket) => {
      resume(Effect.succeed(response.statusCode ?? 101))
      socket.destroy()
    })
    upgrade.once("error", (error) => resume(Effect.fail(error)))
    upgrade.end()
    return Effect.sync(() => upgrade.destroy())
  })

const next = (webSocket: Effect.Success<ReturnType<typeof open>>) => Queue.take(webSocket.messages)

const exchange = Effect.fn("BrowserServerTest.exchange")(function* (
  webSocket: Effect.Success<ReturnType<typeof open>>,
  message: string | Uint8Array,
) {
  yield* Effect.callback<void, Error>((resume) =>
    webSocket.webSocket.send(message, { binary: typeof message !== "string" }, (error) =>
      resume(error ? Effect.fail(error) : Effect.void),
    ),
  )
  return yield* next(webSocket)
})

function bytes(data: NodeSocket.NodeWS.RawData) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data))
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

const tunnelControl = Effect.fn("BrowserServerTest.tunnelControl")(function* (frame: {
  readonly data: string | Uint8Array
}) {
  const decoded = yield* BrowserTunnelProtocol.decodeFromServer(frame.data)
  if (decoded.type !== "control") throw new Error("expected browser tunnel control frame")
  return decoded.message
})

const echoServer = Effect.gen(function* () {
  const connected = yield* Deferred.make<void>()
  const ended = yield* Deferred.make<void>()
  const sentEnd = yield* Deferred.make<void>()
  const sockets = new Set<import("node:net").Socket>()
  const server = yield* Effect.acquireRelease(
    Effect.callback<ReturnType<typeof createServer>, Error>((resume) => {
      const server = createServer({ allowHalfOpen: true }, (socket) => {
        sockets.add(socket)
        Deferred.doneUnsafe(connected, Effect.void)
        socket.on("data", (data) => socket.write(data))
        socket.on("end", () => {
          Deferred.doneUnsafe(ended, Effect.void)
          socket.end(() => Deferred.doneUnsafe(sentEnd, Effect.void))
        })
        socket.once("close", () => sockets.delete(socket))
      })
      server.once("error", (error) => resume(Effect.fail(error)))
      server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)))
      return Effect.sync(() => server.close())
    }),
    (server) =>
      Effect.sync(() => {
        for (const socket of sockets) socket.destroy()
        server.close()
      }),
  )
  return { server, connected, ended, sentEnd }
})

const pushServer = Effect.acquireRelease(
  Effect.callback<ReturnType<typeof createServer>, Error>((resume) => {
    const server = createServer((socket) => socket.end(Buffer.alloc(512 * 1_024, 7)))
    server.once("error", (error) => resume(Effect.fail(error)))
    server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)))
    return Effect.sync(() => server.close())
  }),
  (server) => Effect.sync(() => server.close()),
)

const collectData = Effect.fn("BrowserServerTest.collectData")(function* (
  tunnel: Effect.Success<ReturnType<typeof open>>,
) {
  const received = { bytes: 0, frames: 0 }
  while (true) {
    const decoded = yield* BrowserTunnelProtocol.decodeFromServer((yield* next(tunnel)).data)
    if (decoded.type === "data") {
      tunnel.webSocket.send(
        BrowserTunnelProtocol.encodeFromDesktop({
          type: "browser.tunnel.window",
          bytes: BrowserTunnel.WindowBytes.make(decoded.data.byteLength),
          frames: BrowserTunnel.FrameWindow.make(1),
        }),
        { binary: true },
      )
      received.bytes += decoded.data.byteLength
      received.frames++
      continue
    }
    if (decoded.message.type === "browser.tunnel.window") continue
    if (decoded.message.type === "browser.tunnel.end") return received
    return yield* Effect.fail(new Error(`Unexpected browser tunnel message: ${decoded.message.type}`))
  }
})

it.live(
  "authenticates browser upgrades and tunnels TCP through an attached lease",
  () =>
    Effect.gen(function* () {
      const base = yield* startServer()
      const controlURL = new URL(BrowserControlProtocol.Path, base)
      const tunnelURL = new URL(BrowserTunnelProtocol.Path, base)

      expect(yield* upgradeStatus(controlURL, BrowserControlProtocol.Subprotocol, {})).toBe(401)
      const queryAuth = new URL(controlURL)
      queryAuth.searchParams.set("auth_token", Buffer.from("opencode:secret").toString("base64"))
      expect(yield* upgradeStatus(queryAuth, BrowserControlProtocol.Subprotocol, {})).toBe(401)
      for (const [path, protocol] of [
        ["/api/browser/control/", BrowserControlProtocol.Subprotocol],
        ["/%61pi/%62rowser/%63ontrol", BrowserControlProtocol.Subprotocol],
        ["/API//browser/control;jsessionid=ignored", BrowserControlProtocol.Subprotocol],
        ["/api/browser/tunnel/", BrowserTunnelProtocol.Subprotocol],
        ["/%61pi/%62rowser/%74unnel", BrowserTunnelProtocol.Subprotocol],
      ] as const) {
        const alternate = new URL(path, base)
        alternate.searchParams.set("auth_token", Buffer.from("opencode:secret").toString("base64"))
        expect(yield* upgradeStatus(alternate, protocol, {})).toBe(401)
      }
      expect(yield* upgradeStatus(controlURL, "opencode.browser.control.invalid")).toBe(426)
      expect(
        yield* upgradeStatus(controlURL, BrowserControlProtocol.Subprotocol, {
          authorization,
          origin: "https://malicious.example",
        }),
      ).toBe(403)

      const control = yield* open(controlURL, BrowserControlProtocol.Subprotocol)
      expect(decodeControl((yield* next(control)).data)).toEqual({ type: "browser.control.ready" })
      expect(yield* upgradeStatus(controlURL, BrowserControlProtocol.Subprotocol)).toBe(409)

      const sessionID = Session.ID.make("ses_browser_server")
      const leaseID = Browser.LeaseID.make("brl_browserserver")
      const sessionURL = new URL("/api/session", base)
      sessionURL.protocol = "http:"
      const created = yield* Effect.promise(() =>
        fetch(sessionURL, {
          method: "POST",
          headers: { authorization, "content-type": "application/json" },
          body: JSON.stringify({ id: sessionID }),
        }),
      )
      expect(created.status).toBe(200)
      const acknowledged = yield* exchange(
        control,
        encodeControl({
          type: "browser.control.sync",
          revision: 1,
          attachments: [
            {
              sessionID,
              leaseID,
              state: {
                url: "http://localhost/",
                title: "Local",
                loading: false,
                canGoBack: false,
                canGoForward: false,
                generation: 1,
              },
            },
          ],
        }),
      )
      expect(acknowledged.binary).toBe(false)
      expect(decodeControl(acknowledged.data)).toEqual({ type: "browser.control.synced", revision: 1 })

      const stale = yield* open(tunnelURL, BrowserTunnelProtocol.Subprotocol)
      expect(yield* tunnelControl(yield* next(stale))).toEqual({ type: "browser.tunnel.ready" })
      const rejected = yield* exchange(
        stale,
        BrowserTunnelProtocol.encodeFromDesktop({
          type: "browser.tunnel.open",
          sessionID,
          leaseID: Browser.LeaseID.make("brl_stale"),
          target: { host: BrowserTunnel.Host.make("127.0.0.1"), port: BrowserTunnel.Port.make(1) },
          receiveWindow: BrowserTunnel.WindowSize.make(receiveWindowBytes),
          receiveFrames: BrowserTunnel.FrameWindow.make(receiveWindowFrames),
        }),
      )
      expect(yield* tunnelControl(rejected)).toMatchObject({
        type: "browser.tunnel.rejected",
        code: "stale_lease",
      })
      stale.webSocket.terminate()

      const target = yield* echoServer
      const address = target.server.address()
      if (address === null || typeof address === "string") throw new Error("echo server did not bind TCP")
      const tunnel = yield* open(tunnelURL, BrowserTunnelProtocol.Subprotocol)
      expect(yield* tunnelControl(yield* next(tunnel))).toEqual({ type: "browser.tunnel.ready" })
      const openFrame = BrowserTunnelProtocol.encodeFromDesktop({
        type: "browser.tunnel.open",
        sessionID,
        leaseID,
        target: { host: BrowserTunnel.Host.make("127.0.0.1"), port: BrowserTunnel.Port.make(address.port) },
        receiveWindow: BrowserTunnel.WindowSize.make(receiveWindowBytes),
        receiveFrames: BrowserTunnel.FrameWindow.make(receiveWindowFrames),
      })
      yield* Effect.callback<void, Error>((resume) =>
        tunnel.webSocket.send(openFrame, { binary: true }, (error) => resume(error ? Effect.fail(error) : Effect.void)),
      )
      yield* Deferred.await(target.connected)
      const opened = yield* next(tunnel)
      expect(opened.binary).toBe(true)
      expect(yield* tunnelControl(opened)).toEqual({
        type: "browser.tunnel.opened",
        receiveWindow: BrowserTunnel.WindowSize.make(receiveWindowBytes),
        receiveFrames: BrowserTunnel.FrameWindow.make(receiveWindowFrames),
      })

      yield* Effect.callback<void, Error>((resume) =>
        tunnel.webSocket.send(BrowserTunnelProtocol.data(Buffer.from("browser tunnel")), { binary: true }, (error) =>
          resume(error ? Effect.fail(error) : Effect.void),
        ),
      )
      expect(yield* tunnelControl(yield* next(tunnel))).toEqual({
        type: "browser.tunnel.window",
        bytes: BrowserTunnel.WindowBytes.make(Buffer.byteLength("browser tunnel")),
        frames: BrowserTunnel.FrameWindow.make(1),
      })
      const echoed = yield* next(tunnel)
      expect(echoed.binary).toBe(true)
      const echoedFrame = yield* BrowserTunnelProtocol.decodeFromServer(echoed.data)
      if (echoedFrame.type !== "data") throw new Error("expected browser tunnel data frame")
      expect(Buffer.from(echoedFrame.data).toString()).toBe("browser tunnel")
      tunnel.webSocket.send(
        BrowserTunnelProtocol.encodeFromDesktop({
          type: "browser.tunnel.window",
          bytes: BrowserTunnel.WindowBytes.make(echoedFrame.data.byteLength),
          frames: BrowserTunnel.FrameWindow.make(1),
        }),
        { binary: true },
      )

      tunnel.webSocket.send(BrowserTunnelProtocol.encodeFromDesktop({ type: "browser.tunnel.end" }), { binary: true })
      yield* Deferred.await(target.ended)
      yield* Deferred.await(target.sentEnd)
      const ended = yield* next(tunnel)
      expect(ended.binary).toBe(true)
      expect(yield* tunnelControl(ended)).toEqual({ type: "browser.tunnel.end" })

      tunnel.webSocket.terminate()

      const pushing = yield* pushServer
      const pushingAddress = pushing.address()
      if (pushingAddress === null || typeof pushingAddress === "string") throw new Error("push server did not bind TCP")
      const mismatch = yield* open(tunnelURL, BrowserTunnelProtocol.Subprotocol)
      yield* tunnelControl(yield* next(mismatch))
      yield* exchange(
        mismatch,
        BrowserTunnelProtocol.encodeFromDesktop({
          type: "browser.tunnel.open",
          sessionID,
          leaseID,
          target: { host: BrowserTunnel.Host.make("127.0.0.1"), port: BrowserTunnel.Port.make(pushingAddress.port) },
          receiveWindow: BrowserTunnel.WindowSize.make(BrowserTunnelProtocol.MaxDataBytes),
          receiveFrames: BrowserTunnel.FrameWindow.make(1),
        }),
      )
      const mismatchData = yield* BrowserTunnelProtocol.decodeFromServer((yield* next(mismatch)).data)
      if (mismatchData.type !== "data") throw new Error("expected browser tunnel data frame")
      mismatch.webSocket.send(
        BrowserTunnelProtocol.encodeFromDesktop({
          type: "browser.tunnel.window",
          bytes: BrowserTunnel.WindowBytes.make(mismatchData.data.byteLength - 1),
          frames: BrowserTunnel.FrameWindow.make(1),
        }),
        { binary: true },
      )
      expect(yield* tunnelControl(yield* next(mismatch))).toEqual({
        type: "browser.tunnel.reset",
        code: "protocol_error",
      })
      expect(yield* Deferred.await(mismatch.closed)).toMatchObject({ code: 1002 })

      const large = yield* open(tunnelURL, BrowserTunnelProtocol.Subprotocol)
      yield* tunnelControl(yield* next(large))
      yield* exchange(
        large,
        BrowserTunnelProtocol.encodeFromDesktop({
          type: "browser.tunnel.open",
          sessionID,
          leaseID,
          target: { host: BrowserTunnel.Host.make("127.0.0.1"), port: BrowserTunnel.Port.make(pushingAddress.port) },
          receiveWindow: BrowserTunnel.WindowSize.make(BrowserTunnelProtocol.MaxDataBytes),
          receiveFrames: BrowserTunnel.FrameWindow.make(1),
        }),
      )
      const pushed = yield* collectData(large)
      expect(pushed.bytes).toBe(512 * 1_024)
      expect(pushed.frames).toBeGreaterThanOrEqual(8)
      large.webSocket.send(BrowserTunnelProtocol.encodeFromDesktop({ type: "browser.tunnel.end" }), { binary: true })
      large.webSocket.terminate()

      control.webSocket.terminate()
    }),
  15_000,
)

it.live(
  "rejects an oversized raw tunnel frame before opening a tunnel",
  () =>
    Effect.gen(function* () {
      const base = yield* startServer()
      const control = new Uint8Array(BrowserTunnelProtocol.MaxControlBytes + 2)
      control[0] = controlFrameType
      for (const frame of [new Uint8Array(BrowserTunnelProtocol.MaxDataBytes + 2), control]) {
        const tunnel = yield* open(
          new URL(BrowserTunnelProtocol.Path, base),
          BrowserTunnelProtocol.Subprotocol,
        )
        expect(yield* tunnelControl(yield* next(tunnel))).toEqual({ type: "browser.tunnel.ready" })

        const rejected = yield* exchange(tunnel, frame)
        expect(yield* tunnelControl(rejected)).toMatchObject({
          type: "browser.tunnel.rejected",
          code: "invalid_open",
        })
        expect(yield* Deferred.await(tunnel.closed)).toMatchObject({ code: 1009 })
      }
    }),
  10_000,
)

it.live(
  "closes active browser transports with the service-restart code",
  () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const server = yield* ServerProcess.start<never, never>({
        hostname: "127.0.0.1",
        port: 0,
        password: "secret",
        app: { version: "test-version" },
        database: { path: ":memory:" },
      }).pipe(Effect.provideService(Scope.Scope, scope))
      const base = new URL(HttpServer.formatAddress(server.address))
      base.protocol = "ws:"
      const control = yield* open(
        new URL(BrowserControlProtocol.Path, base),
        BrowserControlProtocol.Subprotocol,
      )
      expect(decodeControl((yield* next(control)).data)).toEqual({ type: "browser.control.ready" })

      const sessionID = Session.ID.make("ses_browser_shutdown")
      const leaseID = Browser.LeaseID.make("brl_browsershutdown")
      const sessionURL = new URL("/api/session", base)
      sessionURL.protocol = "http:"
      const created = yield* Effect.promise(() =>
        fetch(sessionURL, {
          method: "POST",
          headers: { authorization, "content-type": "application/json" },
          body: JSON.stringify({ id: sessionID }),
        }),
      )
      expect(created.status).toBe(200)
      expect(
        decodeControl(
          (yield* exchange(
            control,
            encodeControl({
              type: "browser.control.sync",
              revision: 1,
              attachments: [
                {
                  sessionID,
                  leaseID,
                  state: {
                    url: "http://localhost/",
                    title: "Local",
                    loading: false,
                    canGoBack: false,
                    canGoForward: false,
                    generation: 1,
                  },
                },
              ],
            }),
          )).data,
        ),
      ).toEqual({ type: "browser.control.synced", revision: 1 })

      const target = yield* echoServer
      const address = target.server.address()
      if (address === null || typeof address === "string") throw new Error("echo server did not bind TCP")
      const tunnel = yield* open(new URL(BrowserTunnelProtocol.Path, base), BrowserTunnelProtocol.Subprotocol)
      expect(yield* tunnelControl(yield* next(tunnel))).toEqual({ type: "browser.tunnel.ready" })
      expect(
        yield* tunnelControl(
          yield* exchange(
            tunnel,
            BrowserTunnelProtocol.encodeFromDesktop({
              type: "browser.tunnel.open",
              sessionID,
              leaseID,
              target: { host: BrowserTunnel.Host.make("127.0.0.1"), port: BrowserTunnel.Port.make(address.port) },
              receiveWindow: BrowserTunnel.WindowSize.make(receiveWindowBytes),
              receiveFrames: BrowserTunnel.FrameWindow.make(receiveWindowFrames),
            }),
          ),
        ),
      ).toMatchObject({ type: "browser.tunnel.opened" })

      const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void), { startImmediately: true })
      expect(yield* Deferred.await(control.closed)).toMatchObject({ code: 1012 })
      expect(yield* Deferred.await(tunnel.closed)).toMatchObject({ code: 1012 })
      yield* Fiber.join(closing)
      expect((yield* TestConsole.logLines).filter((line) => String(line).includes("Socket already assigned"))).toEqual(
        [],
      )
    }),
  10_000,
)
