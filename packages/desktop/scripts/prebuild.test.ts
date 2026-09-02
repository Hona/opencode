import { expect, test } from "bun:test"
import { copyFile, cp, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { CLI_BINARIES } from "./utils"

const native = CLI_BINARIES.find((item) => item.os === process.platform && item.cpu === process.arch)!

test.each(["beta", "prod"] as const)("prepares a runnable supplied CLI for %s", async (channel) => {
  const result = await runPrebuild({ channel, distribution: "built", runnable: true })
  expect(result.exitCode).toBe(0)
  expect(result.version).toBe(Bun.version)
  expect(result.requests).toEqual([])
})

for (const channel of [undefined, "", "local", "dev", "snapshot-example"]) {
  test.each([undefined, "empty", "built"] as const)(
    `${String(channel)} downloads dev CLI with distribution %s`,
    async (distribution) => {
      const result = await runPrebuild({ channel, distribution, version: "9.9.9" })
      expect(result.exitCode).toBe(0)
      expect(result.requests).toContain("/dev.tgz")
      expect(result.requests).not.toContain("/beta.tgz")
      expect(result.resources).toContain("ai.opencode.desktop.dev.metainfo.xml")
      expect(result.temporary).toEqual([])
    },
    30_000,
  )
}

test("beta without a distribution downloads the beta CLI", async () => {
  const result = await runPrebuild({ channel: "beta" })
  expect(result.exitCode).toBe(0)
  expect(result.requests).toContain("/beta.tgz")
  expect(result.requests).not.toContain("/dev.tgz")
  expect(result.resources).toContain("ai.opencode.desktop.beta.metainfo.xml")
  expect(result.temporary).toEqual([])
}, 30_000)

for (const channel of ["prod", "latest"]) {
  test.each([undefined, "empty"] as const)(
    `${channel} rejects distribution %s before changing resources`,
    async (distribution) => {
      const result = await runPrebuild({ channel, distribution, stale: true })
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain("OPENCODE_CLI_DIST is required for production desktop builds")
      expect(result.requests).toEqual([])
      expect(result.resources).toEqual([native.os === "win32" ? "opencode-cli.exe" : "opencode-cli"])
      expect(result.content).toBe("stale CLI")
    },
  )
}

for (const channel of ["beta", "prod", "latest"]) {
  test.each(["missing", "wrong-target"] as const)(
    `${channel} does not download after a %s distribution`,
    async (distribution) => {
      const result = await runPrebuild({ channel, distribution, stale: true })
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain("ENOENT")
      expect(result.requests).toEqual([])
      expect(result.content).toBe("stale CLI")
    },
  )

  test(`${channel} copies the same artifact on both preparation passes`, async () => {
    const result = await runPrebuild({ channel, distribution: "built", stale: true, repeat: true })
    expect(result.exitCode).toBe(0)
    expect(result.requests).toEqual([])
    expect(result.resources).toContain(`ai.opencode.desktop${channel === "beta" ? ".beta" : ""}.metainfo.xml`)
    if (process.platform !== "darwin") expect(result.content).toBe(`built ${native.target}`)
    if (process.platform !== "win32") expect(result.mode & 0o777).toBe(0o755)
  })
}

test.each(CLI_BINARIES.filter((item) => item.os === process.platform))(
  "copies the explicitly selected same-OS architecture: %j",
  async (cli) => {
    const result = await runPrebuild({ channel: "prod", distribution: "built", target: cli.target })
    expect(result.exitCode).toBe(0)
    expect(result.requests).toEqual([])
    if (process.platform !== "darwin") expect(result.content).toBe(`built ${cli.target}`)
  },
)

test("rejects an unknown target instead of using the host CLI", async () => {
  const result = await runPrebuild({ channel: "prod", distribution: "built", target: "unknown" })
  expect(result.exitCode).not.toBe(0)
  expect(result.stderr).toContain("CLI configuration not available for target 'unknown'")
  expect(result.requests).toEqual([])
})

test("cleans up a failed registry installation without replacing the existing CLI", async () => {
  const result = await runPrebuild({ channel: "beta", registryFailure: true, stale: true })
  expect(result.exitCode).not.toBe(0)
  expect(result.requests.length).toBeGreaterThan(0)
  expect(result.content).toBe("stale CLI")
  expect(result.temporary).toEqual([])
}, 30_000)

async function runPrebuild(input: {
  channel?: string
  distribution?: "built" | "missing" | "wrong-target" | "empty"
  target?: string
  version?: string
  stale?: boolean
  runnable?: boolean
  repeat?: boolean
  registryFailure?: boolean
}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode prebuild "))
  const cli = CLI_BINARIES.find((item) => item.target === input.target) ?? native
  const destination = path.join(dir, "resources", native.os === "win32" ? "opencode-cli.exe" : "opencode-cli")
  const requests: string[] = []
  const binary = process.platform === "darwin" ? await Bun.file("/usr/bin/true").bytes() : "registry CLI fixture"
  const tarballs = new Map(
    await Promise.all(
      ["dev", "beta"].map(
        async (tag, index) =>
          [
            `/${tag}.tgz`,
            await new Bun.Archive(
              {
                "package/package.json": JSON.stringify({
                  name: cli.package,
                  version: `${index + 1}.0.0`,
                  os: [cli.os],
                  cpu: [cli.cpu],
                }),
                [`package/bin/${cli.os === "win32" ? "opencode2.exe" : "opencode2"}`]: binary,
              },
              { compress: "gzip" },
            ).bytes(),
          ] as const,
      ),
    ),
  )
  using registry = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      const pathname = decodeURIComponent(url.pathname)
      requests.push(pathname)
      if (input.registryFailure) return new Response("fixture registry unavailable", { status: 404 })
      if (pathname === `/${cli.package}`)
        return Response.json({
          name: cli.package,
          "dist-tags": { dev: "1.0.0", beta: "2.0.0" },
          versions: Object.fromEntries(
            ["dev", "beta"].map((tag, index) => [
              `${index + 1}.0.0`,
              {
                name: cli.package,
                version: `${index + 1}.0.0`,
                os: [cli.os],
                cpu: [cli.cpu],
                dist: { tarball: `${url.origin}/${tag}.tgz` },
              },
            ]),
          ),
        })
      const tarball = tarballs.get(pathname)
      return tarball ? new Response(tarball) : new Response("unexpected registry request", { status: 404 })
    },
  })
  try {
    await cp(import.meta.dirname, path.join(dir, "scripts"), {
      recursive: true,
      filter: (file) => !file.endsWith(".test.ts"),
    })
    await Promise.all(
      ["resources", "icons/dev", "icons/beta", "icons/prod", "home", "temporary"].map((file) =>
        mkdir(path.join(dir, file), { recursive: true }),
      ),
    )
    await Bun.write(
      path.join(dir, "home", ".bunfig.toml"),
      `[install]\nregistry = ${JSON.stringify(registry.url.href)}\n`,
    )
    if (input.stale) await Bun.write(destination, "stale CLI")
    if (input.distribution === "built" || input.distribution === "wrong-target") {
      for (const target of CLI_BINARIES.filter((item) => item.os === process.platform)) {
        if (input.distribution === "wrong-target" && target.target === cli.target) continue
        const source = path.join(
          dir,
          "CLI artifacts",
          target.package.replace("@opencode-ai/", ""),
          "bin",
          target.os === "win32" ? "opencode2.exe" : "opencode2",
        )
        await mkdir(path.dirname(source), { recursive: true })
        if (input.runnable) await copyFile(process.execPath, source)
        else await Bun.write(source, process.platform === "darwin" ? binary : `built ${target.target}`)
      }
    }
    const results = []
    for (const pass of input.repeat ? [0, 1] : [0]) {
      if (pass === 1) await Bun.write(destination, "stale CLI")
      const proc = Bun.spawn([process.execPath, "scripts/prebuild.ts"], {
        cwd: dir,
        env: {
          ...process.env,
          GITHUB_ACTIONS: "false",
          HOME: path.join(dir, "home"),
          USERPROFILE: path.join(dir, "home"),
          XDG_CONFIG_HOME: path.join(dir, "home"),
          TMPDIR: path.join(dir, "temporary"),
          TMP: path.join(dir, "temporary"),
          TEMP: path.join(dir, "temporary"),
          npm_config_registry: registry.url.href,
          BUN_INSTALL_CACHE_DIR: path.join(dir, "cache"),
          OPENCODE_CHANNEL: input.channel,
          OPENCODE_VERSION: input.version,
          OPENCODE_CLI_TARGET: input.target ?? native.target,
          OPENCODE_CLI_DIST:
            input.distribution === undefined
              ? undefined
              : input.distribution === "empty"
                ? ""
                : path.join(dir, "CLI artifacts"),
        },
        stdout: "pipe",
        stderr: "pipe",
      })
      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      results.push({ exitCode, stdout, stderr })
      if (exitCode !== 0) break
    }
    const result = results.at(-1)!
    const exists = await Bun.file(destination).exists()
    const version =
      input.runnable && result.exitCode === 0
        ? Bun.spawn([destination, "--version"], { stdout: "pipe", stderr: "inherit" })
        : undefined
    const text = version ? await new Response(version.stdout).text() : undefined
    if (version) expect(await version.exited).toBe(0)
    return {
      ...result,
      requests,
      version: text?.trim(),
      content:
        exists && !input.runnable && (process.platform !== "darwin" || result.exitCode !== 0)
          ? await Bun.file(destination).text()
          : undefined,
      mode: exists ? (await stat(destination)).mode : 0,
      resources: (await readdir(path.join(dir, "resources"))).sort(),
      temporary: (await readdir(path.join(dir, "temporary"))).filter((file) => file.startsWith("opencode-cli-")),
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
