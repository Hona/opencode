import { describe, expect, spyOn, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Installation } from "../../src/installation"
import { Process } from "../../src/util/process"

const encoder = new TextEncoder()

function mockHttpClient(handler: (request: HttpClientRequest.HttpClientRequest) => Response) {
  const client = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handler(request))))
  return Layer.succeed(HttpClient.HttpClient, client)
}

function mockSpawner(handler: (cmd: string, args: readonly string[]) => string = () => "") {
  const spawner = ChildProcessSpawner.make((command) => {
    const std = ChildProcess.isStandardCommand(command) ? command : undefined
    const output = handler(std?.command ?? "", std?.args ?? [])
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
        stdout: output ? Stream.make(encoder.encode(output)) : Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
        getOutputFd: () => Stream.empty,
      }),
    )
  })
  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function testLayer(
  httpHandler: (request: HttpClientRequest.HttpClientRequest) => Response,
  spawnHandler?: (cmd: string, args: readonly string[]) => string,
) {
  return Installation.layer.pipe(Layer.provide(mockHttpClient(httpHandler)), Layer.provide(mockSpawner(spawnHandler)))
}

function mockProcess(opts: Partial<{ text: typeof Process.text; run: typeof Process.run }>) {
  const mocks = [
    opts.text ? spyOn(Process, "text").mockImplementation(opts.text) : undefined,
    opts.run ? spyOn(Process, "run").mockImplementation(opts.run) : undefined,
  ].filter((x) => x !== undefined)

  return () => mocks.forEach((x) => x.mockRestore())
}

describe("installation", () => {
  describe("latest", () => {
    test("reads release version from GitHub releases", async () => {
      const layer = testLayer(() => jsonResponse({ tag_name: "v1.2.3" }))

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("unknown")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("1.2.3")
    })

    test("strips v prefix from GitHub release tag", async () => {
      const layer = testLayer(() => jsonResponse({ tag_name: "v4.0.0-beta.1" }))

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("curl")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("4.0.0-beta.1")
    })

    test("reads npm registry versions", async () => {
      const restore = mockProcess({
        text: async (cmd) => ({
          code: 0,
          stdout: Buffer.from(cmd[0] === "npm" && cmd.includes("registry") ? "https://registry.npmjs.org\n" : ""),
          stderr: Buffer.alloc(0),
          text: cmd[0] === "npm" && cmd.includes("registry") ? "https://registry.npmjs.org\n" : "",
        }),
      })
      const layer = testLayer(
        () => jsonResponse({ version: "1.5.0" }),
        () => "",
      )

      try {
        const result = await Effect.runPromise(
          Installation.Service.use((svc) => svc.latest("npm")).pipe(Effect.provide(layer)),
        )
        expect(result).toBe("1.5.0")
      } finally {
        restore()
      }
    })

    test("reads npm registry versions for bun method", async () => {
      const restore = mockProcess({
        text: async () => ({
          code: 0,
          stdout: Buffer.from("https://registry.npmjs.org\n"),
          stderr: Buffer.alloc(0),
          text: "https://registry.npmjs.org\n",
        }),
      })
      const layer = testLayer(
        () => jsonResponse({ version: "1.6.0" }),
        () => "",
      )

      try {
        const result = await Effect.runPromise(
          Installation.Service.use((svc) => svc.latest("bun")).pipe(Effect.provide(layer)),
        )
        expect(result).toBe("1.6.0")
      } finally {
        restore()
      }
    })

    test("reads scoop manifest versions", async () => {
      const layer = testLayer(() => jsonResponse({ version: "2.3.4" }))

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("scoop")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("2.3.4")
    })

    test("reads chocolatey feed versions", async () => {
      const layer = testLayer(() => jsonResponse({ d: { results: [{ Version: "3.4.5" }] } }))

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("choco")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("3.4.5")
    })

    test("reads brew formulae API versions", async () => {
      const restore = mockProcess({
        text: async (cmd, opts) => {
          const out =
            cmd[0] === "brew" &&
            cmd.includes("--formula") &&
            cmd.includes("opencode") &&
            !cmd.includes("anomalyco/tap/opencode")
              ? "opencode"
              : ""
          return {
            code: 0,
            stdout: Buffer.from(out),
            stderr: Buffer.alloc(0),
            text: out,
          }
        },
      })
      const layer = testLayer(
        () => jsonResponse({ versions: { stable: "2.0.0" } }),
        () => "",
      )

      try {
        const result = await Effect.runPromise(
          Installation.Service.use((svc) => svc.latest("brew")).pipe(Effect.provide(layer)),
        )
        expect(result).toBe("2.0.0")
      } finally {
        restore()
      }
    })

    test("reads brew tap info JSON via CLI", async () => {
      const brewInfoJson = JSON.stringify({
        formulae: [{ versions: { stable: "2.1.0" } }],
      })
      const restore = mockProcess({
        text: async (cmd) => {
          const out =
            cmd[0] === "brew" && cmd.includes("anomalyco/tap/opencode") && cmd.includes("--formula")
              ? "opencode"
              : cmd[0] === "brew" && cmd.includes("--json=v2")
                ? brewInfoJson
                : ""
          return {
            code: 0,
            stdout: Buffer.from(out),
            stderr: Buffer.alloc(0),
            text: out,
          }
        },
      })
      const layer = testLayer(
        () => jsonResponse({}), // HTTP not used for tap formula
        () => "",
      )

      try {
        const result = await Effect.runPromise(
          Installation.Service.use((svc) => svc.latest("brew")).pipe(Effect.provide(layer)),
        )
        expect(result).toBe("2.1.0")
      } finally {
        restore()
      }
    })
  })

  describe("method", () => {
    test("uses Process text for package manager detection", async () => {
      const restore = mockProcess({
        text: async (cmd) => {
          const out = cmd[0] === "npm" ? "opencode-ai@1.3.0" : ""
          return {
            code: 0,
            stdout: Buffer.from(out),
            stderr: Buffer.alloc(0),
            text: out,
          }
        },
      })
      const layer = testLayer(() => jsonResponse({ tag_name: "v0.0.0" }))

      try {
        const result = await Effect.runPromise(
          Installation.Service.use((svc) => svc.method()).pipe(Effect.provide(layer)),
        )
        expect(result).toBe("npm")
      } finally {
        restore()
      }
    })
  })

  describe("upgrade", () => {
    test("uses Process run for npm upgrades", async () => {
      const seen: string[][] = []
      const restore = mockProcess({
        run: async (cmd) => {
          seen.push([...cmd])
          return {
            code: 0,
            stdout: Buffer.alloc(0),
            stderr: Buffer.alloc(0),
          }
        },
        text: async () => ({
          code: 0,
          stdout: Buffer.from("1.2.3"),
          stderr: Buffer.alloc(0),
          text: "1.2.3",
        }),
      })
      const layer = testLayer(() => jsonResponse({ tag_name: "v0.0.0" }))

      try {
        await Effect.runPromise(
          Installation.Service.use((svc) => svc.upgrade("npm", "1.2.3")).pipe(Effect.provide(layer)),
        )
        expect(seen).toContainEqual(["npm", "install", "-g", "opencode-ai@1.2.3"])
      } finally {
        restore()
      }
    })
  })
})
