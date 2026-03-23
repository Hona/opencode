import path from "path"
import fs from "fs/promises"
import { createWriteStream } from "fs"
import { Global } from "../global"
import z from "zod"
import { Glob } from "./glob"

// Lazy-loaded telemetry to avoid circular dependency
let telemetryModule: typeof import("@/telemetry") | undefined
let telemetryLoading = false

function emitOtelLog(level: string, message: string, attributes: Record<string, any>) {
  // Prevent recursive calls during module loading
  if (telemetryLoading) return
  if (!telemetryModule) {
    telemetryLoading = true
    import("@/telemetry")
      .then((mod) => {
        telemetryModule = mod
        telemetryLoading = false
        doEmit(mod.Telemetry, level, message, attributes)
      })
      .catch(() => {
        telemetryLoading = false
      })
    return
  }
  doEmit(telemetryModule.Telemetry, level, message, attributes)
}

function doEmit(
  Telemetry: (typeof import("@/telemetry"))["Telemetry"],
  level: string,
  message: string,
  attributes: Record<string, any>,
) {
  if (!Telemetry.isEnabled()) return

  const logger = Telemetry.getLogger("opencode")
  const severityNumber = Telemetry.SeverityMap[level]
  if (!severityNumber) return

  // Build body with key=value pairs like file logs, service first
  const service = attributes.service
  const otherAttrs = Object.entries(attributes).filter(([key]) => key !== "service")

  const formatValue = (key: string, value: any): string => {
    if (value instanceof Error) return `${key}=${value.message}`
    if (typeof value === "object") return `${key}=${JSON.stringify(value)}`
    return `${key}=${value}`
  }

  const parts: string[] = []
  if (service) parts.push(`service=${service}`)
  for (const [key, value] of otherAttrs) {
    if (value !== undefined && value !== null) {
      parts.push(formatValue(key, value))
    }
  }
  parts.push(message)

  const body = parts.join(" ")

  // Find any Error in attributes and extract for OTEL exception semantic conventions
  const errorEntry = Object.entries(attributes).find(([_, v]) => v instanceof Error)
  const finalAttributes = { ...attributes }

  if (errorEntry) {
    const error = errorEntry[1] as Error
    // Add OTEL semantic convention attributes for exceptions
    finalAttributes["exception.type"] = error.name || "Error"
    finalAttributes["exception.message"] = error.message
    if (error.stack) {
      finalAttributes["exception.stacktrace"] = error.stack
    }
  }

  logger.emit({
    severityNumber,
    severityText: level,
    body,
    attributes: finalAttributes,
  })
}

export namespace Log {
  export const Level = z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).meta({ ref: "LogLevel", description: "Log level" })
  export type Level = z.infer<typeof Level>

  const levelPriority: Record<Level, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  }

  let level: Level = "INFO"

  function shouldLog(input: Level): boolean {
    return levelPriority[input] >= levelPriority[level]
  }

  export type Logger = {
    debug(message?: any, extra?: Record<string, any>): void
    info(message?: any, extra?: Record<string, any>): void
    error(message?: any, extra?: Record<string, any>): void
    warn(message?: any, extra?: Record<string, any>): void
    tag(key: string, value: string): Logger
    clone(): Logger
    time(
      message: string,
      extra?: Record<string, any>,
    ): {
      stop(): void
      [Symbol.dispose](): void
    }
  }

  const loggers = new Map<string, Logger>()

  export const Default = create({ service: "default" })

  export interface Options {
    print: boolean
    dev?: boolean
    level?: Level
  }

  let logpath = ""
  export function file() {
    return logpath
  }
  let write = (msg: any) => {
    process.stderr.write(msg)
    return msg.length
  }

  export async function init(options: Options) {
    if (options.level) level = options.level
    cleanup(Global.Path.log)
    if (options.print) return
    logpath = path.join(
      Global.Path.log,
      options.dev ? "dev.log" : new Date().toISOString().split(".")[0].replace(/:/g, "") + ".log",
    )
    await fs.truncate(logpath).catch(() => {})
    const stream = createWriteStream(logpath, { flags: "a" })
    write = async (msg: any) => {
      return new Promise((resolve, reject) => {
        stream.write(msg, (err) => {
          if (err) reject(err)
          else resolve(msg.length)
        })
      })
    }
  }

  async function cleanup(dir: string) {
    const files = await Glob.scan("????-??-??T??????.log", {
      cwd: dir,
      absolute: true,
      include: "file",
    })
    if (files.length <= 5) return

    const filesToDelete = files.slice(0, -10)
    await Promise.all(filesToDelete.map((file) => fs.unlink(file).catch(() => {})))
  }

  function formatError(error: Error, depth = 0): string {
    const result = error.message
    return error.cause instanceof Error && depth < 10
      ? result + " Caused by: " + formatError(error.cause, depth + 1)
      : result
  }

  let last = Date.now()
  export function create(tags?: Record<string, any>) {
    tags = tags || {}

    const service = tags["service"]
    if (service && typeof service === "string") {
      const cached = loggers.get(service)
      if (cached) {
        return cached
      }
    }

    function build(message: any, extra?: Record<string, any>) {
      const prefix = Object.entries({
        ...tags,
        ...extra,
      })
        .filter(([_, value]) => value !== undefined && value !== null)
        .map(([key, value]) => {
          const prefix = `${key}=`
          if (value instanceof Error) return prefix + formatError(value)
          if (typeof value === "object") return prefix + JSON.stringify(value)
          return prefix + value
        })
        .join(" ")
      const next = new Date()
      const diff = next.getTime() - last
      last = next.getTime()
      return [next.toISOString().split(".")[0], "+" + diff + "ms", prefix, message].filter(Boolean).join(" ") + "\n"
    }
    const result: Logger = {
      debug(message?: any, extra?: Record<string, any>) {
        if (shouldLog("DEBUG")) {
          write("DEBUG " + build(message, extra))
          emitOtelLog("DEBUG", String(message ?? ""), { ...tags, ...extra })
        }
      },
      info(message?: any, extra?: Record<string, any>) {
        if (shouldLog("INFO")) {
          write("INFO  " + build(message, extra))
          emitOtelLog("INFO", String(message ?? ""), { ...tags, ...extra })
        }
      },
      error(message?: any, extra?: Record<string, any>) {
        if (shouldLog("ERROR")) {
          write("ERROR " + build(message, extra))
          emitOtelLog("ERROR", String(message ?? ""), { ...tags, ...extra })
        }
      },
      warn(message?: any, extra?: Record<string, any>) {
        if (shouldLog("WARN")) {
          write("WARN  " + build(message, extra))
          emitOtelLog("WARN", String(message ?? ""), { ...tags, ...extra })
        }
      },
      tag(key: string, value: string) {
        if (tags) tags[key] = value
        return result
      },
      clone() {
        return Log.create({ ...tags })
      },
      time(message: string, extra?: Record<string, any>) {
        const now = Date.now()
        result.info(message, { status: "started", ...extra })
        function stop() {
          result.info(message, {
            status: "completed",
            duration: Date.now() - now,
            ...extra,
          })
        }
        return {
          stop,
          [Symbol.dispose]() {
            stop()
          },
        }
      },
    }

    if (service && typeof service === "string") {
      loggers.set(service, result)
    }

    return result
  }
}
