import { trace, type Span, SpanStatusCode, type AttributeValue } from "@opentelemetry/api"
export { traced } from "./traced.ts"
import { logs, SeverityNumber } from "@opentelemetry/api-logs"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions"
import { NodeSDK } from "@opentelemetry/sdk-node"
import { LoggerProvider, BatchLogRecordProcessor } from "@opentelemetry/sdk-logs"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc"
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-grpc"
import { Installation } from "@/installation"
import { Log } from "@/util/log"

export namespace Telemetry {
  const log = Log.create({ service: "telemetry" })

  export interface Config {
    enabled: boolean
    endpoint: string
    serviceName: string
  }

  let sdk: NodeSDK | undefined
  let loggerProvider: LoggerProvider | undefined
  let initialized = false

  export function resolveConfig(
    serviceName: string,
    experimental?: boolean | { enabled?: boolean; endpoint?: string },
  ): Config {
    const defaultEndpoint = "http://localhost:4317"

    if (typeof experimental === "boolean") {
      return {
        enabled: experimental,
        endpoint: defaultEndpoint,
        serviceName,
      }
    }

    if (typeof experimental === "object") {
      return {
        enabled: experimental.enabled !== false,
        endpoint: experimental.endpoint || defaultEndpoint,
        serviceName,
      }
    }

    return {
      enabled: false,
      endpoint: defaultEndpoint,
      serviceName,
    }
  }

  export function init(config: Config): void {
    if (initialized) return
    if (!config.enabled) return

    log.info("initializing", { endpoint: config.endpoint })

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: Installation.VERSION,
    })

    const traceExporter = new OTLPTraceExporter({
      url: config.endpoint,
    })

    const logExporter = new OTLPLogExporter({
      url: config.endpoint,
    })

    loggerProvider = new LoggerProvider({
      resource,
      processors: [new BatchLogRecordProcessor(logExporter)],
    })
    logs.setGlobalLoggerProvider(loggerProvider)

    sdk = new NodeSDK({
      resource,
      traceExporter,
    })

    sdk.start()
    initialized = true
    log.info("initialized")
  }

  export async function shutdown(): Promise<void> {
    if (!initialized) return

    log.info("shutting down")
    await Promise.all([
      sdk?.shutdown().catch((e) => log.error("sdk shutdown error", { error: e })),
      loggerProvider?.shutdown().catch((e) => log.error("logger shutdown error", { error: e })),
    ])
    initialized = false
    log.info("shutdown complete")
  }

  export function isEnabled(): boolean {
    return initialized
  }

  export function getTracer(name: string) {
    return trace.getTracer(name)
  }

  export function getLogger(name: string) {
    return logs.getLogger(name)
  }

  export const NOOP_SPAN: Span = {
    spanContext: () => ({ traceId: "", spanId: "", traceFlags: 0 }),
    setAttribute: () => NOOP_SPAN,
    setAttributes: () => NOOP_SPAN,
    addEvent: () => NOOP_SPAN,
    addLink: () => NOOP_SPAN,
    addLinks: () => NOOP_SPAN,
    setStatus: () => NOOP_SPAN,
    updateName: () => NOOP_SPAN,
    end: () => {},
    isRecording: () => false,
    recordException: () => {},
  }

  export async function withSpan<T>(
    name: string,
    attributes: Record<string, AttributeValue>,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    if (!initialized) {
      return fn(NOOP_SPAN)
    }

    const tracer = getTracer("opencode")
    return tracer.startActiveSpan(name, { attributes }, async (span) => {
      try {
        const result = await fn(span)
        return result
      } catch (error) {
        if (error instanceof Error) {
          span.recordException(error)
        }
        span.setStatus({ code: SpanStatusCode.ERROR })
        throw error
      } finally {
        span.end()
      }
    })
  }

  export const SeverityMap: Record<string, SeverityNumber> = {
    DEBUG: SeverityNumber.DEBUG,
    INFO: SeverityNumber.INFO,
    WARN: SeverityNumber.WARN,
    ERROR: SeverityNumber.ERROR,
  }

  /**
   * Flattens an object into OpenTelemetry span attributes with a prefix.
   * Only captures primitives (string, number, boolean), skips undefined/null.
   * Truncates strings longer than 200 characters.
   */
  export function flattenAttributes(prefix: string, obj: Record<string, unknown>): Record<string, AttributeValue> {
    const result: Record<string, AttributeValue> = {}
    for (const key in obj) {
      const value = obj[key]
      if (value === undefined || value === null) continue
      if (typeof value === "string") {
        result[`${prefix}${key}`] = value.length > 200 ? value.slice(0, 200) + "..." : value
      } else if (typeof value === "number" || typeof value === "boolean") {
        result[`${prefix}${key}`] = value
      }
    }
    return result
  }

  export type DisposableSpan = Span & Disposable

  // Create a self-referential NOOP disposable span
  const NOOP_DISPOSABLE_SPAN: DisposableSpan = {
    spanContext: () => ({ traceId: "", spanId: "", traceFlags: 0 }),
    setAttribute: function () {
      return this
    },
    setAttributes: function () {
      return this
    },
    addEvent: function () {
      return this
    },
    addLink: function () {
      return this
    },
    addLinks: function () {
      return this
    },
    setStatus: function () {
      return this
    },
    updateName: function () {
      return this
    },
    end: () => {},
    isRecording: () => false,
    recordException: () => {},
    [Symbol.dispose]: () => {},
  }

  /**
   * Creates a span that can be used with the `using` keyword for automatic cleanup.
   * Returns a NOOP span if telemetry is not initialized.
   *
   * @example
   * ```ts
   * using span = Telemetry.span("my.operation", { "attr.key": "value" })
   * // span.end() is automatically called when scope exits
   * ```
   */
  export function span(name: string, attrs: Record<string, AttributeValue> = {}): DisposableSpan {
    if (!initialized) {
      return NOOP_DISPOSABLE_SPAN
    }

    const tracer = getTracer("opencode")
    const activeSpan = tracer.startSpan(name, { attributes: attrs })

    return Object.assign(activeSpan, {
      [Symbol.dispose]: () => {
        activeSpan.end()
      },
    })
  }
}
