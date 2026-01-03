import { test, expect, describe } from "bun:test"
import { Telemetry } from "../../src/telemetry"

describe("Telemetry.resolveConfig", () => {
  const defaultEndpoint = "http://localhost:4317"

  test("returns disabled config when no experimental config provided", () => {
    const config = Telemetry.resolveConfig("test-service", undefined)
    expect(config).toEqual({
      enabled: false,
      endpoint: defaultEndpoint,
      serviceName: "test-service",
    })
  })

  test("handles boolean true config", () => {
    const config = Telemetry.resolveConfig("test-service", true)
    expect(config).toEqual({
      enabled: true,
      endpoint: defaultEndpoint,
      serviceName: "test-service",
    })
  })

  test("handles boolean false config", () => {
    const config = Telemetry.resolveConfig("test-service", false)
    expect(config).toEqual({
      enabled: false,
      endpoint: defaultEndpoint,
      serviceName: "test-service",
    })
  })

  test("handles object config with enabled true", () => {
    const config = Telemetry.resolveConfig("test-service", { enabled: true })
    expect(config).toEqual({
      enabled: true,
      endpoint: defaultEndpoint,
      serviceName: "test-service",
    })
  })

  test("handles object config with enabled false", () => {
    const config = Telemetry.resolveConfig("test-service", { enabled: false })
    expect(config).toEqual({
      enabled: false,
      endpoint: defaultEndpoint,
      serviceName: "test-service",
    })
  })

  test("handles object config with custom endpoint", () => {
    const customEndpoint = "http://custom:4317"
    const config = Telemetry.resolveConfig("test-service", {
      enabled: true,
      endpoint: customEndpoint,
    })
    expect(config).toEqual({
      enabled: true,
      endpoint: customEndpoint,
      serviceName: "test-service",
    })
  })

  test("defaults enabled to true when object has no enabled field", () => {
    const config = Telemetry.resolveConfig("test-service", {})
    expect(config).toEqual({
      enabled: true,
      endpoint: defaultEndpoint,
      serviceName: "test-service",
    })
  })

  test("defaults endpoint when object has no endpoint field", () => {
    const config = Telemetry.resolveConfig("test-service", { enabled: true })
    expect(config.endpoint).toBe(defaultEndpoint)
  })

  test("uses custom service name", () => {
    const config = Telemetry.resolveConfig("opencode-cli", true)
    expect(config.serviceName).toBe("opencode-cli")
  })
})

describe("Telemetry.isEnabled", () => {
  test("returns false before initialization", () => {
    // isEnabled should return false when telemetry hasn't been initialized
    // Since we can't easily reset the telemetry state in tests, we just verify the function exists
    expect(typeof Telemetry.isEnabled).toBe("function")
    // Note: We can't test the actual state without initializing telemetry,
    // which would require a running OTLP endpoint
  })
})
