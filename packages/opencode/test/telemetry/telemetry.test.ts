import { test, expect, describe } from "bun:test"
import { Telemetry } from "../../src/telemetry"
import type { ModelMessage } from "ai"

describe("Telemetry.resolveConfig", () => {
  const defaultEndpoint = "http://localhost:4317"

  test("returns disabled config when not enabled", () => {
    const config = Telemetry.resolveConfig("test-service", undefined)
    expect(config).toEqual({
      enabled: false,
      endpoint: defaultEndpoint,
      serviceName: "test-service",
    })
  })

  test("returns enabled config when true", () => {
    const config = Telemetry.resolveConfig("test-service", true)
    expect(config).toEqual({
      enabled: true,
      endpoint: defaultEndpoint,
      serviceName: "test-service",
    })
  })

  test("returns disabled config when false", () => {
    const config = Telemetry.resolveConfig("test-service", false)
    expect(config).toEqual({
      enabled: false,
      endpoint: defaultEndpoint,
      serviceName: "test-service",
    })
  })

  test("uses custom service name", () => {
    const config = Telemetry.resolveConfig("opencode-cli", true)
    expect(config.serviceName).toBe("opencode-cli")
  })
})

describe("Telemetry.isEnabled", () => {
  test("returns false before initialization", () => {
    expect(typeof Telemetry.isEnabled).toBe("function")
  })
})

describe("Telemetry.toGenAIProvider", () => {
  test("maps openai to openai", () => {
    expect(Telemetry.toGenAIProvider("openai")).toBe("openai")
  })

  test("maps anthropic to anthropic", () => {
    expect(Telemetry.toGenAIProvider("anthropic")).toBe("anthropic")
  })

  test("maps google to gcp.gen_ai", () => {
    expect(Telemetry.toGenAIProvider("google")).toBe("gcp.gen_ai")
  })

  test("maps unknown provider to itself", () => {
    expect(Telemetry.toGenAIProvider("unknown")).toBe("unknown")
  })
})

describe("Telemetry.stringifyMessagesForGenAI", () => {
  test("converts string content messages", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "You are a helpful assistant" },
      { role: "user", content: "Hello" },
    ]
    const result = Telemetry.stringifyMessagesForGenAI(messages)
    const parsed = JSON.parse(result)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toEqual({
      role: "system",
      parts: [{ type: "text", content: "You are a helpful assistant" }],
    })
    expect(parsed[1]).toEqual({
      role: "user",
      parts: [{ type: "text", content: "Hello" }],
    })
  })

  test("converts array content with text parts", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Hello world" }],
      },
    ]
    const result = Telemetry.stringifyMessagesForGenAI(messages)
    const parsed = JSON.parse(result)
    expect(parsed[0].parts).toEqual([{ type: "text", content: "Hello world" }])
  })

  test("converts tool-call parts", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-123",
            toolName: "search",
            input: { query: "test" },
          },
        ],
      },
    ]
    const result = Telemetry.stringifyMessagesForGenAI(messages)
    const parsed = JSON.parse(result)
    expect(parsed[0].parts[0]).toEqual({
      type: "tool_call",
      id: "call-123",
      name: "search",
      arguments: { query: "test" },
    })
  })

  test("converts tool-result parts", () => {
    const messages: ModelMessage[] = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-123",
            toolName: "search",
            output: "found" as any,
          },
        ],
      },
    ]
    const result = Telemetry.stringifyMessagesForGenAI(messages)
    const parsed = JSON.parse(result)
    expect(parsed[0].parts[0]).toEqual({
      type: "tool_call_response",
      id: "call-123",
      response: { result: "found" },
    })
  })

  test("converts reasoning parts to text", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "Let me think..." }],
      },
    ]
    const result = Telemetry.stringifyMessagesForGenAI(messages)
    const parsed = JSON.parse(result)
    expect(parsed[0].parts[0]).toEqual({
      type: "text",
      content: "Let me think...",
    })
  })

  test("handles mixed content types", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Here's my answer:" },
          { type: "tool-call", toolCallId: "call-1", toolName: "calc", input: { x: 1 } },
        ],
      },
    ]
    const result = Telemetry.stringifyMessagesForGenAI(messages)
    const parsed = JSON.parse(result)
    expect(parsed[0].parts).toHaveLength(2)
    expect(parsed[0].parts[0].type).toBe("text")
    expect(parsed[0].parts[1].type).toBe("tool_call")
  })

  test("returns empty parts for unknown content types", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "image", image: "base64..." } as any],
      },
    ]
    const result = Telemetry.stringifyMessagesForGenAI(messages)
    const parsed = JSON.parse(result)
    expect(parsed[0].parts).toEqual([])
  })
})
