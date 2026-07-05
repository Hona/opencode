import { describe, expect, test } from "bun:test"
import { effectiveSettingsServer } from "./global"

describe("effectiveSettingsServer", () => {
  const local = { key: "local" }
  const remote = { key: "remote" }
  const key = (server: { key: string }) => server.key

  test("uses the selected server when it is available", () => {
    expect(effectiveSettingsServer("remote", [local, remote], key)).toEqual({
      key: "remote",
      connection: remote,
    })
  })

  test("falls back without replacing a selection that can return", () => {
    expect(effectiveSettingsServer("remote", [local], key)).toEqual({ key: "local", connection: local })
    expect(effectiveSettingsServer("remote", [local, remote], key)).toEqual({
      key: "remote",
      connection: remote,
    })
  })
})
