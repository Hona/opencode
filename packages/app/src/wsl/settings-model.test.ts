import { describe, expect, test } from "bun:test"
import { wslOpencodeAction, wslRuntimePresentation } from "./settings-model"

describe("WSL server settings presentation", () => {
  test("maps each runtime state to one presentation", () => {
    expect(wslRuntimePresentation({ kind: "starting" })).toEqual({ label: "Starting", retryable: false })
    expect(wslRuntimePresentation({ kind: "ready", url: "http://127.0.0.1:4096", username: null, password: null })).toEqual({
      label: "Running",
      retryable: false,
    })
    expect(wslRuntimePresentation({ kind: "failed", message: "boom" })).toEqual({ label: "Failed", retryable: true })
    expect(wslRuntimePresentation({ kind: "stopped" })).toEqual({ label: "Stopped", retryable: true })
  })

  test("offers install and update only when OpenCode needs attention", () => {
    expect(wslOpencodeAction(undefined)).toBeUndefined()
    expect(
      wslOpencodeAction({
        distro: "Debian",
        resolvedPath: null,
        version: null,
        expectedVersion: "1.2.3",
        matchesDesktop: null,
        error: null,
      }),
    ).toBe("Install OpenCode")
    expect(
      wslOpencodeAction({
        distro: "Debian",
        resolvedPath: "/usr/local/bin/opencode",
        version: "1.2.2",
        expectedVersion: "1.2.3",
        matchesDesktop: false,
        error: null,
      }),
    ).toBe("Update OpenCode")
    expect(
      wslOpencodeAction({
        distro: "Debian",
        resolvedPath: "/usr/local/bin/opencode",
        version: "1.2.3",
        expectedVersion: "1.2.3",
        matchesDesktop: true,
        error: null,
      }),
    ).toBeUndefined()
  })
})
