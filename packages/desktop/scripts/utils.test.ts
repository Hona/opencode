import { expect, test } from "bun:test"
import { getCurrentCli, resolveChannel, windowsify } from "./utils"

test.each([
  [undefined, "dev"],
  ["", "dev"],
  ["local", "dev"],
  ["dev", "dev"],
  ["beta", "beta"],
  ["prod", "prod"],
  ["latest", "prod"],
  ["snapshot-example", "dev"],
  ["PROD", "dev"],
] as const)("normalizes packaging channel %s to %s", (raw, expected) => {
  const previous = process.env.OPENCODE_CHANNEL
  try {
    if (raw === undefined) delete process.env.OPENCODE_CHANNEL
    else process.env.OPENCODE_CHANNEL = raw
    expect(resolveChannel()).toBe(expected)
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_CHANNEL
    else process.env.OPENCODE_CHANNEL = previous
  }
})

test.each([
  ["aarch64-apple-darwin", "cli-darwin-arm64", "darwin", "arm64"],
  ["x86_64-apple-darwin", "cli-darwin-x64-baseline", "darwin", "x64"],
  ["aarch64-pc-windows-msvc", "cli-windows-arm64", "win32", "arm64"],
  ["x86_64-pc-windows-msvc", "cli-windows-x64-baseline", "win32", "x64"],
  ["x86_64-unknown-linux-gnu", "cli-linux-x64-baseline", "linux", "x64"],
  ["aarch64-unknown-linux-gnu", "cli-linux-arm64", "linux", "arm64"],
] as const)("selects the CLI artifact for %s", (target, name, os, cpu) => {
  expect(getCurrentCli(target)).toEqual({ target, package: `@opencode-ai/${name}`, os, cpu })
})

test.each(["", "unknown", "aarch64-unknown-linux-musl"])("rejects unsupported CLI target %s", (target) => {
  expect(() => getCurrentCli(target)).toThrow("CLI configuration not available")
})

test("does not append a second executable suffix", () => {
  expect(windowsify("resources/opencode-cli.exe")).toBe("resources/opencode-cli.exe")
  expect(windowsify("resources/opencode-cli")).toBe(
    process.platform === "win32" ? "resources/opencode-cli.exe" : "resources/opencode-cli",
  )
})
