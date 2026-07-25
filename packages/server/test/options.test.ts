import { expect, test } from "bun:test"
import { fromEnvironment, ServerOptions } from "@opencode-ai/server/options"
import { Option, Schema } from "effect"

const decode = Schema.decodeUnknownOption(ServerOptions)

test("accepts ephemeral port zero", () => {
  expect(Option.isSome(decode({ port: 0 }))).toBe(true)
})

test("rejects ports outside the valid range", () => {
  expect(Option.isNone(decode({ port: -1 }))).toBe(true)
  expect(Option.isNone(decode({ port: 65_536 }))).toBe(true)
})

test("accepts optional app metadata", () => {
  expect(Option.getOrThrow(decode({ app: { name: "sdk", version: "1.2.3", channel: "beta" } })).app).toEqual({
    name: "sdk",
    version: "1.2.3",
    channel: "beta",
  })
})

test("assembles shared environment options without overriding explicit host options", () => {
  expect(
    fromEnvironment(
      {
        app: { channel: "beta" },
        database: { path: ":memory:" },
        models: { fetch: false },
      },
      {
        OPENCODE_DB: "environment.db",
        OPENCODE_MODELS_URL: "https://models.example.test",
        OPENCODE_DISABLE_FILEWATCHER: "true",
      },
    ),
  ).toMatchObject({
    database: { path: ":memory:" },
    models: { url: "https://models.example.test", fetch: false },
    fs: { filewatcher: false },
  })
})

test("selects the channel database through the shared server option seam", () => {
  expect(fromEnvironment({ app: { channel: "prod" } }, {}).database?.path).toBe("opencode.db")
  expect(fromEnvironment({ app: { channel: "feature/test" } }, {}).database?.path).toBe("opencode-feature-test.db")
})
