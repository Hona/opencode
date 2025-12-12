import { describe, expect, test } from "bun:test"
import path from "path"

/**
 * Test to verify the Windows clipboard memory leak pattern exists.
 *
 * These tests confirm the LEAKY code pattern is present (pre-fix).
 * After fixing, these tests should FAIL - update them to check for the fix.
 */

describe("Windows Clipboard Leak Pattern Detection", () => {
  test("clipboard.ts uses shell $ pattern (leaky on Windows)", async () => {
    const clipboardPath = path.join(process.cwd(), "packages/opencode/src/cli/cmd/tui/util/clipboard.ts")
    const content = await Bun.file(clipboardPath).text()

    // Current LEAKY pattern - uses $ which doesn't guarantee cleanup
    expect(content).toContain('if (os === "win32")')
    expect(content).toContain("powershell")

    // This is the LEAK: using $ instead of Bun.spawn with explicit cleanup
    expect(content).toContain("await $`powershell")

    console.log("✓ Confirmed: clipboard.ts uses leaky $ pattern for Windows")
  })

  test("bash.ts taskkill lacks explicit cleanup (leaky)", async () => {
    const bashPath = path.join(process.cwd(), "packages/opencode/src/tool/bash.ts")
    const content = await Bun.file(bashPath).text()

    expect(content).toContain('process.platform === "win32"')
    expect(content).toContain("taskkill")

    // Current LEAKY pattern - no removeAllListeners/unref
    expect(content).not.toContain("removeAllListeners")
    expect(content).not.toContain("killer.unref")

    console.log("✓ Confirmed: bash.ts taskkill lacks explicit cleanup")
  })

  test("lsp/server.ts has ElixirLS typo (.bar instead of .bat)", async () => {
    const lspPath = path.join(process.cwd(), "packages/opencode/src/lsp/server.ts")
    const content = await Bun.file(lspPath).text()

    // Bug: typo in filename
    expect(content).toContain("language_server.bar")

    console.log("✓ Confirmed: lsp/server.ts has ElixirLS .bar typo")
  })
})
