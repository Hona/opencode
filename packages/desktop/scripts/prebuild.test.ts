import { expect, test } from "bun:test"
import { copyFile, cp, mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { CLI_BINARIES } from "./utils"

test.each(["beta", "prod"] as const)("prepares the supplied CLI for %s", async (channel) => {
  const result = await runPrebuild(channel, "built")
  expect(result.exitCode).toBe(0)
  expect(result.version).toBe(Bun.version)
})

test("requires a prebuilt CLI distribution for prod", async () => {
  const result = await runPrebuild("prod", "unset")
  expect(result.exitCode).not.toBe(0)
  expect(result.stderr).toContain("OPENCODE_CLI_DIST is required for production desktop builds")
  expect(result.version).toBeUndefined()
})

test("fails when the supplied prod distribution has no CLI", async () => {
  const result = await runPrebuild("prod", "missing")
  expect(result.exitCode).not.toBe(0)
  expect(result.stderr).toContain("ENOENT")
  expect(result.version).toBeUndefined()
})

async function runPrebuild(channel: "beta" | "prod", distribution: "built" | "unset" | "missing") {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-desktop-prebuild-"))
  const cli = CLI_BINARIES.find((item) => item.os === process.platform && item.cpu === process.arch)!
  const source = path.join(dir, "cli", cli.package.replace("@opencode-ai/", ""), "bin")
  const destination = path.join(dir, "resources", cli.os === "win32" ? "opencode-cli.exe" : "opencode-cli")
  try {
    await cp(import.meta.dirname, path.join(dir, "scripts"), {
      recursive: true,
      filter: (file) => !file.endsWith(".test.ts"),
    })
    await mkdir(path.join(dir, "resources"), { recursive: true })
    await mkdir(path.join(dir, "icons", channel), { recursive: true })
    if (distribution === "built") {
      await mkdir(source, { recursive: true })
      await copyFile(process.execPath, path.join(source, cli.os === "win32" ? "opencode2.exe" : "opencode2"))
    }
    const proc = Bun.spawn([process.execPath, "scripts/prebuild.ts"], {
      cwd: dir,
      env: {
        ...process.env,
        GITHUB_ACTIONS: "false",
        OPENCODE_CHANNEL: channel,
        OPENCODE_CLI_TARGET: cli.target,
        OPENCODE_CLI_DIST: distribution === "unset" ? "" : path.join(dir, "cli"),
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, , stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    if (exitCode !== 0) return { exitCode, stderr }
    const version = Bun.spawn([destination, "--version"], { stdout: "pipe", stderr: "pipe" })
    const [status, stdout] = await Promise.all([version.exited, new Response(version.stdout).text()])
    expect(status).toBe(0)
    return { exitCode, stderr, version: stdout.trim() }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
