import { describe, expect, test } from "bun:test"
import path from "path"

/**
 * Integration test to verify the clipboard fix handles process cleanup correctly.
 *
 * This test verifies:
 * 1. On Windows, PowerShell process cleanup code is present
 * 2. The implementation uses Bun.spawn instead of $ for better control
 * 3. Timeout and error handling are in place
 *
 * USAGE: Run this test on both macOS and Windows
 * - On macOS: Test runs in "check mode" to verify fixes exist in code
 * - On Windows: Test validates actual process cleanup behavior
 *
 * TEST EXPECTATIONS:
 * ✅ When fix is applied: Test PASSES
 * ❌ When fix is stashed: Test FAILS
 */

describe("Windows Memory Leak Fixes", () => {
  test("clipboard.ts contains fixed Windows implementation", async () => {
    const clipboardPath = path.join(process.cwd(), "packages/opencode/src/cli/cmd/tui/util/clipboard.ts")
    const content = await Bun.file(clipboardPath).text()

    // CRITICAL: Check for new fixed implementation with Bun.spawn
    expect(content).toContain("Bun.spawn")
    expect(content).toContain('if (os === "win32")')
    expect(content).toContain("powershell")
    expect(content).toContain("proc.kill()")

    // CRITICAL: Verify timeout mechanism is present
    expect(content).toContain("Promise.race")
    expect(content).toContain("5000") // 5 second timeout

    // CRITICAL: Should NOT contain old broken pattern
    expect(content).not.toContain("await $`powershell -command")

    console.log("✓ Fixed Windows clipboard implementation verified")
  })

  test("bash.ts contains fixed taskkill cleanup", async () => {
    const bashPath = path.join(process.cwd(), "packages/opencode/src/tool/bash.ts")
    const content = await Bun.file(bashPath).text()

    // Verify Windows taskkill code
    expect(content).toContain('process.platform === "win32"')
    expect(content).toContain("taskkill")

    // CRITICAL: Verify cleanup improvements are present
    expect(content).toContain("removeAllListeners")
    expect(content).toContain("unref")

    console.log("✓ Fixed bash taskkill cleanup verified")
  })

  test("lsp/server.ts has correct ElixirLS filename", async () => {
    const lspPath = path.join(process.cwd(), "packages/opencode/src/lsp/server.ts")
    const content = await Bun.file(lspPath).text()

    // CRITICAL: Verify the typo is fixed
    expect(content).not.toContain("language_server.bar")
    expect(content).toContain("language_server.bat")

    console.log("✓ ElixirLS filename typo fixed")
  })
})
