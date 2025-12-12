import { describe, expect, test } from "bun:test"
import { platform } from "os"

/**
 * Memory leak reproduction test for clipboard operations.
 *
 * - macOS: Should PASS (no leak - reasonable per-operation overhead)
 * - Windows: Should FAIL (leak - PowerShell processes accumulate without cleanup)
 */

const isWindows = platform() === "win32"

describe("Clipboard Memory Leak", () => {
  test("memory growth per clipboard operation should be reasonable", async () => {
    const { Clipboard } = await import("../../src/cli/cmd/tui/util/clipboard")

    if (typeof Bun.gc === "function") Bun.gc(true)

    const baselineRSS = process.memoryUsage.rss()
    // Windows PowerShell is slow - use fewer iterations there
    const iterations = isWindows ? 100 : 10000

    console.log(`\nRunning ${iterations} clipboard operations on ${platform()}...`)

    for (let i = 0; i < iterations; i++) {
      await Clipboard.copy(`Memory test ${i}`)
    }

    if (typeof Bun.gc === "function") Bun.gc(true)
    await new Promise((r) => setTimeout(r, 1000))

    const finalRSS = process.memoryUsage.rss()
    const growthMB = (finalRSS - baselineRSS) / 1024 / 1024
    const growthPerOpKB = (growthMB * 1024) / iterations

    console.log(`\nMemory after ${iterations} clipboard operations:`)
    console.log(`  Platform:       ${platform()}`)
    console.log(`  Baseline:       ${(baselineRSS / 1024 / 1024).toFixed(2)}MB`)
    console.log(`  Final:          ${(finalRSS / 1024 / 1024).toFixed(2)}MB`)
    console.log(`  Total Growth:   ${growthMB.toFixed(2)}MB`)
    console.log(`  Per Operation:  ${growthPerOpKB.toFixed(2)}KB`)

    // macOS: ~9KB per op is normal baseline overhead
    // Windows with leak: significantly higher due to process accumulation
    expect(growthPerOpKB).toBeLessThan(25)
  }, 600000) // 10 minute timeout

  test.skipIf(!isWindows)(
    "PowerShell processes should not accumulate",
    async () => {
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

      const iterations = 50
      for (let i = 0; i < iterations; i++) {
        await Clipboard.copy(`Process test ${i}`)
      }

      await new Promise((r) => setTimeout(r, 2000))

      const afterProcesses = countPowershellProcesses()
      const growth = afterProcesses - baselineProcesses

      console.log(`After ${iterations} copies: ${afterProcesses} processes`)
      console.log(`Process growth: ${growth}`)

      // If leak exists, processes will accumulate
      expect(growth).toBeLessThan(10)
    },
    600000,
  ) // 10 minute timeout
})
