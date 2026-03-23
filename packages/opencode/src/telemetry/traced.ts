import type { AttributeValue, Span } from "@opentelemetry/api"
import { Telemetry } from "./index.ts"

/**
 * Higher-order function that wraps a function with OpenTelemetry tracing.
 * Preserves the original function's return type and handles errors appropriately.
 *
 * @param name - The span name (e.g., "session.prompt", "llm.stream")
 * @param attributesFn - Function that extracts span attributes from the input
 * @returns A function that takes the target function and returns a traced version
 *
 * @example
 * ```ts
 * export const myFunction = traced(
 *   "my.operation",
 *   (input) => ({ "input.key": input.key })
 * )(async (input) => {
 *   // function body
 *   return result
 * })
 * ```
 */
export function traced<TInput, TOutput>(
  name: string,
  attributesFn: (input: TInput) => Record<string, AttributeValue>,
): (fn: (input: TInput, span: Span) => Promise<TOutput>) => (input: TInput) => Promise<TOutput> {
  return (fn) => {
    return (input) => {
      const attributes = attributesFn(input)
      return Telemetry.withSpan(name, attributes, (span) => fn(input, span))
    }
  }
}
