import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { developmentService, developmentUserData } from "./development-service"

describe("development service", () => {
  test("uses Electron's platform-specific development profile", () => {
    expect(developmentUserData("win32", { APPDATA: "C:\\Users\\dev\\AppData\\Roaming" }, "C:\\Users\\dev")).toBe(
      "C:\\Users\\dev\\AppData\\Roaming\\ai.opencode.desktop.dev",
    )
    expect(developmentUserData("darwin", {}, "/Users/dev")).toBe(
      "/Users/dev/Library/Application Support/ai.opencode.desktop.dev",
    )
    expect(developmentUserData("linux", { XDG_CONFIG_HOME: "/state/config" }, "/home/dev")).toBe(
      "/state/config/ai.opencode.desktop.dev",
    )
    expect(developmentUserData("linux", {}, "/home/dev")).toBe("/home/dev/.config/ai.opencode.desktop.dev")
  })

  test("owns the standard CLI service invocation", () => {
    const cli = join("repo", "packages", "cli")
    const userData = join("state", "desktop")
    expect(developmentService({ cli, userData, version: "local-test" })).toEqual({
      file: join(userData, "opencode", "service-local.json"),
      version: "local-test",
      command: [
        "bun",
        "run",
        "--cwd",
        cli,
        '--define=OPENCODE_VERSION="local-test"',
        "src/index.ts",
        "serve",
        "--service",
        "--port",
        "0",
      ],
      env: {
        XDG_STATE_HOME: userData,
        OPENCODE_CLIENT: "desktop",
        OPENCODE_DISABLE_EMBEDDED_WEB_UI: "true",
      },
    })
  })
})
