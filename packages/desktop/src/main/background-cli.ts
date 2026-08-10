import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { chmod, copyFile, mkdir, rename, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { app } from "electron"

const execFileAsync = promisify(execFile)
const root = dirname(fileURLToPath(import.meta.url))
const stateHome = process.env.XDG_STATE_HOME
const desktopStateNames = ["ai.opencode.desktop.dev", "ai.opencode.desktop.beta", "ai.opencode.desktop"]

type Logger = {
  log(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

type ServiceTarget = {
  stateHome?: string
  command: "start" | "restart"
  existing: boolean
}

export async function startBackgroundCli(logger: Logger, shellStateHome?: string) {
  const isolated = !app.isPackaged && process.env.OPENCODE_DESKTOP_ISOLATED_SERVER === "1"
  const binary = await resolveCli(logger, isolated)
  const service = isolated ? isolatedService() : await sharedService(binary, logger, shellStateHome)
  return connect(binary, service, logger)
}

async function resolveCli(logger: Logger, isolated: boolean) {
  const bundled = app.isPackaged
    ? join(process.resourcesPath, executableName())
    : join(root, "../../resources", executableName())
  logger.log("v2 CLI executable resolved", { bundled, packaged: app.isPackaged })
  const version = await run(bundled, ["--version"], logger)
  return app.isPackaged || isolated ? installCli(bundled, version, logger) : bundled
}

function isolatedService(): ServiceTarget {
  return { stateHome: app.getPath("userData"), command: "restart", existing: false }
}

async function sharedService(binary: string, logger: Logger, shellStateHome?: string): Promise<ServiceTarget> {
  const found = await findBackgroundCli(binary, logger, shellStateHome)
  logger.log("v2 CLI background instance checked", {
    detected: Boolean(found),
    ...endpoint(found?.url),
  })
  return { stateHome: found?.stateHome ?? stateHome, command: "start", existing: Boolean(found) }
}

async function connect(binary: string, service: ServiceTarget, logger: Logger) {
  const url = await run(binary, ["service", service.command], logger, { stateHome: service.stateHome })
  const password = await run(binary, ["service", "get", "password"], logger, {
    redact: true,
    stateHome: service.stateHome,
  })
  logger.log("v2 CLI background service ready", {
    existing: service.existing,
    username: "opencode",
    ...endpoint(url),
  })
  return { url, username: "opencode", password }
}

async function findBackgroundCli(binary: string, logger: Logger, shellStateHome?: string) {
  const candidates = [
    ...new Set([stateHome, shellStateHome, ...desktopStateNames.map((name) => join(app.getPath("appData"), name))]),
  ].filter((candidate) => candidate === undefined || existsSync(candidate))
  return (
    await Promise.all(
      candidates.map(async (candidate) => ({
        stateHome: candidate,
        url: serviceUrl(await run(binary, ["service", "status"], logger, { stateHome: candidate })),
      })),
    )
  ).find((candidate) => candidate.url !== undefined)
}

async function installCli(source: string, version: string, logger: Logger) {
  const directory = join(app.getPath("userData"), "cli", version.replace(/[^a-zA-Z0-9._-]/g, "-"))
  const destination = join(directory, executableName())
  if (existsSync(destination)) {
    logger.log("v2 CLI staged executable reused", { path: destination, version })
    return destination
  }

  const temp = destination + `.${process.pid}.tmp`
  await mkdir(directory, { recursive: true })
  await copyFile(source, temp)
  if (process.platform !== "win32") await chmod(temp, 0o755)
  await rename(temp, destination).catch(async (error) => {
    await rm(temp, { force: true })
    throw error
  })
  logger.log("v2 CLI executable staged", { source, path: destination, version })
  return destination
}

async function run(
  binary: string,
  args: string[],
  logger: Logger,
  options: { redact?: boolean; stateHome?: string } = {},
) {
  logger.log("v2 CLI command started", { binary, args })
  const env = { ...process.env }
  if (options.stateHome === undefined) delete env.XDG_STATE_HOME
  else env.XDG_STATE_HOME = options.stateHome
  return execFileAsync(binary, args, { env, windowsHide: true }).then(
    (result) => {
      const stdout = result.stdout.trim()
      const stderr = result.stderr.trim()
      logger.log("v2 CLI command completed", { args, stdout: options.redact ? "[redacted]" : stdout, stderr })
      return stdout
    },
    (error: unknown) => {
      const output = error as { stdout?: string; stderr?: string }
      logger.error("v2 CLI command failed", {
        args,
        error: error instanceof Error ? error.message : String(error),
        stdout: options.redact && output.stdout ? "[redacted]" : (output.stdout?.trim() ?? ""),
        stderr: output.stderr?.trim() ?? "",
      })
      throw error
    },
  )
}

function serviceUrl(status: string) {
  if (URL.canParse(status)) return status
  if (!status.startsWith("running ")) return
  const url = status.slice("running ".length).trim()
  return URL.canParse(url) ? url : undefined
}

function endpoint(url: string | undefined) {
  if (!url || !URL.canParse(url)) return {}
  const parsed = new URL(url)
  return { url, hostname: parsed.hostname, port: parsed.port }
}

function executableName() {
  return process.platform === "win32" ? "opencode-cli.exe" : "opencode-cli"
}
