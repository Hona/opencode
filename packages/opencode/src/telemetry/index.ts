import { context, trace, type Span, SpanStatusCode, SpanKind, type AttributeValue } from "@opentelemetry/api"
export { SpanKind } from "@opentelemetry/api"
export { traced } from "./traced.ts"
import { logs, SeverityNumber } from "@opentelemetry/api-logs"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions"
import { NodeSDK } from "@opentelemetry/sdk-node"
import { LoggerProvider, BatchLogRecordProcessor } from "@opentelemetry/sdk-logs"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc"
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-grpc"
import { registerInstrumentations } from "@opentelemetry/instrumentation"
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici"
import { FsInstrumentation } from "@opentelemetry/instrumentation-fs"
import { DnsInstrumentation } from "@opentelemetry/instrumentation-dns"
import type { ModelMessage } from "ai"
import { Installation } from "@/installation"
import { Log } from "@/util/log"
import { Flag } from "@/flag/flag"
import os from "os"

export namespace Telemetry {
  const log = Log.create({ service: "telemetry" })

  export interface Config {
    enabled: boolean
    endpoint: string
    serviceName: string
    isWorker?: boolean
    workerId?: string
    workerPurpose?: string
  }

  let sdk: NodeSDK | undefined
  let loggerProvider: LoggerProvider | undefined
  let initialized = false

  export function resolveConfig(serviceName: string, enabled?: boolean, isWorker?: boolean, workerId?: string, workerPurpose?: string): Config {
    return {
      enabled: enabled ?? false,
      endpoint: Flag.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4317",
      serviceName,
      isWorker: isWorker ?? false,
      workerId: workerId ?? (isWorker ? "unknown" : "main-thread"),
      workerPurpose: workerPurpose ?? (isWorker ? "general" : "cli"),
    }
  }

  export function init(config: Config): void {
    if (initialized) return
    if (!config.enabled) return

    log.info("initializing", { endpoint: config.endpoint, serviceName: config.serviceName, isWorker: config.isWorker })

    const instanceId = config.isWorker 
      ? `worker-${config.workerId}-${process.pid}` 
      : `main-${process.pid}`

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: Installation.VERSION,
      "service.instance.id": instanceId,
      "host.name": os.hostname(),
      "process.pid": process.pid,
      "opencode.component.type": config.isWorker ? "worker" : "main",
      "opencode.worker.id": config.workerId || "main-thread",
      "opencode.worker.purpose": config.workerPurpose || (config.isWorker ? "general" : "cli"),
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

    registerInstrumentations({
      instrumentations: [
        new UndiciInstrumentation({
          headersToSpanAttributes: {
            requestHeaders: ["content-type"],
            responseHeaders: ["content-type"],
          },
        }),
        new FsInstrumentation(),
        new DnsInstrumentation(),
      ],
    })

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
    kind?: SpanKind,
  ): Promise<T> {
    if (!initialized) {
      return fn(NOOP_SPAN)
    }

    const tracer = getTracer("opencode")
    return tracer.startActiveSpan(name, { attributes, kind }, async (span) => {
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

  export function withSpanSync<T>(
    name: string,
    attributes: Record<string, AttributeValue>,
    fn: (span: Span) => T,
    kind?: SpanKind,
  ): T {
    if (!initialized) {
      return fn(NOOP_SPAN)
    }

    const tracer = getTracer("opencode")
    return tracer.startActiveSpan(name, { attributes, kind }, (span) => {
      try {
        const result = fn(span)
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
   * Maps opencode provider IDs to standard GenAI provider names.
   * Used for OpenTelemetry GenAI semantic conventions.
   */
  const providerMapping: Record<string, string> = {
    "openai": "openai",
    "anthropic": "anthropic",
    "google": "gcp.gen_ai",
    "bedrock": "aws.bedrock",
    "azure-openai": "azure.ai.openai",
    "groq": "groq",
    "mistral": "mistral_ai",
    "cohere": "cohere",
    "deepseek": "deepseek",
    "perplexity": "perplexity",
  }

  /**
   * Returns the standard GenAI provider name for a given opencode provider ID.
   * Falls back to the original provider ID if no mapping exists.
   */
  export function setSpanAttribute(key: string, value: AttributeValue): void {
    if (!initialized) return
    const span = trace.getActiveSpan()
    if (span) {
      span.setAttribute(key, value)
    }
  }

  export function addSpanEvent(name: string, attributes?: Record<string, AttributeValue>): void {
    if (!initialized) return
    const span = trace.getActiveSpan()
    if (span) {
      span.addEvent(name, attributes)
    }
  }

  export function shouldCaptureMessageContent(): boolean {
    return Flag.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT
  }

  export function stringifyMessagesForGenAI(messages: ModelMessage[]): string {
    const parts = messages.map((msg): object => {
      const role = msg.role === "tool" ? "tool" : msg.role
      if (typeof msg.content === "string") {
        return { role, parts: [{ type: "text", content: msg.content }] }
      }
      if (Array.isArray(msg.content)) {
        const msgParts = msg.content.flatMap((part): object[] => {
          switch (part.type) {
            case "text":
              return [{ type: "text", content: part.text }]
            case "tool-call":
              return [{
                type: "tool_call",
                id: part.toolCallId,
                name: part.toolName,
                arguments: part.input,
              }]
            case "tool-result":
              return [{
                type: "tool_call_response",
                id: part.toolCallId,
                response: part.output,
              }]
            case "reasoning":
              return [{ type: "text", content: part.text }]
            default:
              return []
          }
        })
        return { role, parts: msgParts }
      }
      return { role, parts: [] }
    })
    return JSON.stringify(parts)
  }

  /**
   * Returns the standard GenAI provider name for a given opencode provider ID.
   * Falls back to the original provider ID if no mapping exists.
   */
  export function toGenAIProvider(providerID: string): string {
    return providerMapping[providerID] ?? providerID
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
   * Sets the span as the active context so child spans nest correctly.
   * Returns a NOOP span if telemetry is not initialized.
   *
   * @example
   * ```ts
   * using span = Telemetry.span("my.operation", { "attr.key": "value" })
   * // span is active context — child spans will nest under it
   * // span.end() is automatically called when scope exits
   * ```
   */
  export function span(name: string, attrs: Record<string, AttributeValue> = {}, kind?: SpanKind): DisposableSpan {
    if (!initialized) {
      return NOOP_DISPOSABLE_SPAN
    }

    const tracer = getTracer("opencode")
    const parentCtx = context.active()
    const s = tracer.startSpan(name, { attributes: attrs, kind }, parentCtx)
    const ctx = trace.setSpan(parentCtx, s)

    // Access the underlying AsyncLocalStorage to enter the new context.
    // The OTel JS API only provides callback-based context.with(), but the
    // using/disposable pattern requires enter/exit semantics.
    try {
      const mgr = (context as any)["_getContextManager"]?.()
      const als = mgr?._asyncLocalStorage ?? mgr?.active
      if (als?.enterWith) {
        als.enterWith(ctx)
      }
    } catch {}

    return Object.assign(s, {
      [Symbol.dispose]: () => {
        try {
          const mgr = (context as any)["_getContextManager"]?.()
          const als = mgr?._asyncLocalStorage ?? mgr?.active
          if (als?.enterWith) {
            als.enterWith(parentCtx)
          }
        } catch {}
        s.end()
      },
    })
  }
}
