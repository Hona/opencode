import { trace, type Span, SpanStatusCode, type AttributeValue } from "@opentelemetry/api"
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

  export function resolveConfig(experimental?: boolean | { enabled?: boolean; endpoint?: string }): Config {
    const envEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT

    if (typeof experimental === "boolean") {
      return {
        enabled: experimental,
        endpoint: envEndpoint || "http://localhost:4317",
        serviceName: "opencode",
      }
    }

    if (typeof experimental === "object") {
      return {
        enabled: experimental.enabled !== false,
        endpoint: envEndpoint || experimental.endpoint || "http://localhost:4317",
        serviceName: "opencode",
      }
    }

    return {
      enabled: !!envEndpoint,
      endpoint: envEndpoint || "http://localhost:4317",
      serviceName: "opencode",
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

  const NOOP_SPAN: Span = {
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
}
