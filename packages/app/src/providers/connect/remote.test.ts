import { expect, test } from "bun:test"
import { authServerName } from "./remote"

const contributed = {
  type: "extension",
  key: "ssh:production",
  extension: "ssh",
  state: "ready",
  connecting: false,
  authenticationRequired: false,
  managed: true,
  http: { url: "http://127.0.0.1:4096" },
} as const

test("SSH disclosure uses the remote identity even with a loopback proxy", () => {
  expect(authServerName({ ...contributed, displayName: "Production server" })).toBe("Production server")
})

test("local Desktop and loopback HTTP connections do not show remote disclosure", () => {
  expect(authServerName({ type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:4096" } })).toBeUndefined()
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    expect(authServerName({ type: "http", http: { url: `http://${host}:4096` } })).toBeUndefined()
  }
})

test("WSL and remote HTTP connections show their server identity", () => {
  expect(authServerName({ ...contributed, key: "wsl:Ubuntu", extension: "wsl", displayName: "Ubuntu" })).toBe("Ubuntu")
  expect(authServerName({ type: "http", http: { url: "https://production.example" } })).toBe("production.example")
})
