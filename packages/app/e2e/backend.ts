import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

type Handle = {
  url: string
  stop: () => Promise<void>
}

const time = {
  health: 60_000,
  sandbox: 30_000,
  stop: 30_000,
} as const

const phase = async <T>(name: string, timeout: number, fn: () => Promise<T> | T) => {
  const start = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  console.error(`[e2e:backend] start ${name} timeout=${timeout}ms`)
  return Promise.race([
    Promise.resolve().then(fn),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${timeout}ms: backend ${name}`)), timeout)
    }),
  ])
    .then(
      (value) => {
        console.error(`[e2e:backend] done ${name} (${Date.now() - start}ms)`)
        return value
      },
      (err) => {
        console.error(`[e2e:backend] failed ${name} (${Date.now() - start}ms)`)
        console.error(err)
        throw err
      },
    )
    .finally(() => {
      if (timer) clearTimeout(timer)
    })
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire a free port")))
        return
      }
      server.close((err) => {
        if (err) reject(err)
        else resolve(address.port)
      })
    })
  })
}

async function waitForHealth(url: string, probe = "/global/health") {
  const end = Date.now() + time.health
  let last = ""
  while (Date.now() < end) {
    try {
      const res = await fetch(`${url}${probe}`)
      if (res.ok) return
      last = `status ${res.status}`
    } catch (err) {
      last = err instanceof Error ? err.message : String(err)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for backend health at ${url}${probe}${last ? ` (${last})` : ""}`)
}

function done(proc: ReturnType<typeof spawn>) {
  return proc.exitCode !== null || proc.signalCode !== null
}

async function waitExit(proc: ReturnType<typeof spawn>, timeout = 10_000) {
  if (done(proc)) return
  await Promise.race([
    new Promise<void>((resolve) => proc.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, timeout)),
  ])
}

const LOG_CAP = 100

function cap(input: string[]) {
  if (input.length > LOG_CAP) input.splice(0, input.length - LOG_CAP)
}

function tail(input: string[]) {
  return input.slice(-40).join("")
}

function live(label: string, url: string, kind: string, on: boolean) {
  let rest = ""
  const write = (line: string) => {
    if (!on || !line) return
    console.error(`[e2e:backend] ${label} ${kind} ${url} ${line}`)
  }
  return {
    push(chunk: string) {
      rest += chunk
      while (true) {
        const i = rest.indexOf("\n")
        if (i < 0) return
        write(rest.slice(0, i).replace(/\r$/, ""))
        rest = rest.slice(i + 1)
      }
    },
    flush() {
      write(rest.trimEnd())
      rest = ""
    },
  }
}

function dump(label: string, url: string, out: string[], err: string[], kind: string) {
  const stdout = tail(out).trimEnd()
  const stderr = tail(err).trimEnd()
  if (stdout) console.error(`[e2e:backend] ${label} ${kind} stdout ${url}\n${stdout}`)
  if (stderr) console.error(`[e2e:backend] ${label} ${kind} stderr ${url}\n${stderr}`)
}

export async function startBackend(label: string, input?: { llmUrl?: string }): Promise<Handle> {
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), `opencode-e2e-${label}-`))
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const repoDir = path.resolve(appDir, "../..")
  const opencodeDir = path.join(repoDir, "packages", "opencode")
  const env = {
    ...process.env,
    OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
    OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "true",
    OPENCODE_TEST_HOME: path.join(sandbox, "home"),
    XDG_DATA_HOME: path.join(sandbox, "share"),
    XDG_CACHE_HOME: path.join(sandbox, "cache"),
    XDG_CONFIG_HOME: path.join(sandbox, "config"),
    XDG_STATE_HOME: path.join(sandbox, "state"),
    OPENCODE_CLIENT: "app",
    OPENCODE_STRICT_CONFIG_DEPS: "true",
    OPENCODE_E2E_LLM_URL: input?.llmUrl,
  } satisfies Record<string, string | undefined>
  delete env.OPENCODE_E2E_LOG_CLEANUP
  const out: string[] = []
  const err: string[] = []
  const stderr = live(label, url, "stderr", true)
  const stdout = live(label, url, "stdout", false)
  let stop = false
  const proc = spawn(
    "bun",
    [
      "run",
      "--conditions=browser",
      "./src/index.ts",
      "--print-logs",
      "--log-level",
      "WARN",
      "serve",
      "--port",
      String(port),
      "--hostname",
      "127.0.0.1",
    ],
    {
      cwd: opencodeDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  proc.stdout?.on("data", (chunk) => {
    const text = String(chunk)
    out.push(text)
    cap(out)
    stdout.push(text)
  })
  proc.stderr?.on("data", (chunk) => {
    const text = String(chunk)
    err.push(text)
    cap(err)
    stderr.push(text)
  })
  proc.once("error", (cause) => {
    stdout.flush()
    stderr.flush()
    console.error(`[e2e:backend] ${label} process error ${url}`)
    console.error(cause)
    dump(label, url, out, err, "error")
  })
  proc.on("exit", (code, signal) => {
    stdout.flush()
    stderr.flush()
    console.error(
      `[e2e:backend] ${label} exit ${url} code=${code ?? "null"} signal=${signal ?? "null"} stop=${stop ? 1 : 0}`,
    )
    if (!stop && (code !== 0 || signal !== null)) dump(label, url, out, err, "unexpected exit")
  })
  proc.on("close", (code, signal) => {
    stdout.flush()
    stderr.flush()
    console.error(
      `[e2e:backend] ${label} close ${url} code=${code ?? "null"} signal=${signal ?? "null"} stop=${stop ? 1 : 0}`,
    )
  })
  console.error(`[e2e:backend] ${label} spawn pid=${proc.pid} ${url} sandbox=${sandbox}`)

  try {
    await phase(`${label} health ${url}`, time.health, () => waitForHealth(url))
  } catch (error) {
    stop = true
    proc.kill("SIGTERM")
    await fs.rm(sandbox, { recursive: true, force: true }).catch(() => undefined)
    throw new Error(
      [
        `Failed to start isolated e2e backend for ${label}`,
        error instanceof Error ? error.message : String(error),
        out.length ? `stdout tail:\n${tail(out).trimEnd()}` : "",
        err.length ? `stderr tail:\n${tail(err).trimEnd()}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }

  return {
    url,
    async stop() {
      stop = true
      await phase(`${label} stop ${url}`, time.stop, async () => {
        if (!done(proc)) {
          proc.kill("SIGTERM")
          await waitExit(proc)
        }
        if (!done(proc)) {
          console.error(`[e2e:backend] ${label} forcing SIGKILL ${url}`)
          dump(label, url, out, err, "pre-sigkill")
          proc.kill("SIGKILL")
          await waitExit(proc)
        }
      }).catch(() => undefined)
      await phase(`${label} sandbox ${url}`, time.sandbox, () =>
        fs.rm(sandbox, { recursive: true, force: true }),
      ).catch(() => undefined)
    },
  }
}
