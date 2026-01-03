import { test, expect, describe } from "bun:test"
import { Telemetry } from "../../src/telemetry"

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
