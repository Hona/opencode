import { describe, expect, test } from "bun:test"
import { platform } from "os"

/**
 * Memory leak reproduction test for clipboard operations.
 *
 * - macOS: Should PASS (no leak - uses osascript properly)
 * - Windows: Should FAIL (leak exists - PowerShell processes accumulate)
 */

const isWindows = platform() === "win32"

describe("Clipboard Memory Leak", () => {
  test("memory should not grow significantly after many clipboard operations", async () => {
    const { Clipboard } = await import("../../src/cli/cmd/tui/util/clipboard")

    if (typeof Bun.gc === "function") Bun.gc(true)

    const baselineRSS = process.memoryUsage.rss()
    const iterations = 10000

    console.log(`\nRunning ${iterations} clipboard operations on ${platform()}...`)

    for (let i = 0; i < iterations; i++) {
      await Clipboard.copy(`Memory test ${i} - ${"x".repeat(500)}`)
    }

    if (typeof Bun.gc === "function") Bun.gc(true)
    await new Promise((r) => setTimeout(r, 1000))

    const finalRSS = process.memoryUsage.rss()
    const growthMB = (finalRSS - baselineRSS) / 1024 / 1024

    console.log(`\nMemory after ${iterations} clipboard operations:`)
    console.log(`  Platform: ${platform()}`)
    console.log(`  Baseline: ${(baselineRSS / 1024 / 1024).toFixed(2)}MB`)
    console.log(`  Final:    ${(finalRSS / 1024 / 1024).toFixed(2)}MB`)
    console.log(`  Growth:   ${growthMB.toFixed(2)}MB`)

    // macOS: should pass (minimal growth)
    // Windows: should fail (significant growth due to leak)
    expect(growthMB).toBeLessThan(30)
  })

  test.skipIf(!isWindows)("PowerShell processes should not accumulate", async () => {
    const { Clipboard } = await import("../../src/cli/cmd/tui/util/clipboard")
    const { execSync } = await import("child_process")

    const countPowershellProcesses = () => {
      try {
        const output = execSync('tasklist /FI "IMAGENAME eq powershell.exe" /NH', { encoding: "utf8" })
        return output.split("\n").filter((line) => line.includes("powershell")).length
      } catch {
        return 0
      }
    }

    const baselineProcesses = countPowershellProcesses()
    console.log(`\nBaseline PowerShell processes: ${baselineProcesses}`)

    const iterations = 10000
    for (let i = 0; i < iterations; i++) {
      await Clipboard.copy(`Process test ${i} - ${Date.now()}`)
    }

    await new Promise((r) => setTimeout(r, 500))

    const afterProcesses = countPowershellProcesses()
    const growth = afterProcesses - baselineProcesses

    console.log(`After ${iterations} copies: ${afterProcesses} processes`)
    console.log(`Process growth: ${growth}`)

    // Should fail on Windows if leak exists
    expect(growth).toBeLessThan(5)
  })
})
