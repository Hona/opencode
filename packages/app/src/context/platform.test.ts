import { describe, expect, test } from "bun:test"
import { clientOS, serverOS, type Platform } from "./platform"

describe("platform helpers", () => {
  test("prefers server os when available", () => {
    const platform: Platform = {
      platform: "desktop",
      os: "linux",
      openLink() {},
      async restart() {},
      back() {},
      forward() {},
      async notify() {},
    }

    expect(serverOS({ os: "windows" }, platform)).toBe("windows")
  })

  test("falls back to the client os", () => {
    const platform: Platform = {
      platform: "desktop",
      os: "macos",
      openLink() {},
      async restart() {},
      back() {},
      forward() {},
      async notify() {},
    }

    expect(clientOS(platform)).toBe("macos")
    expect(serverOS(undefined, platform)).toBe("macos")
  })
})
