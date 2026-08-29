import { expect, test } from "bun:test"
import path from "node:path"

test.each(["exit", "timeout", "no-timeout"])(
  "releases the preflight context after %s while keeping shell history",
  async (mode) => {
    const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixture/shell-retention.ts"), mode], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 25_000,
      killSignal: "SIGKILL",
    })
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
      const result = JSON.parse(stdout)
      expect(result.controlRetained).toBe(false)
      expect(result.retained).toBe(false)
      expect(result.status).toBe(mode === "timeout" ? "timeout" : "exited")
      expect(result.outputSize).toBe(1024 * 1024)
      expect(result.outputPrefix).toBe("x".repeat(16))
      expect(result.waitMatchesHistory).toBe(true)
      expect(result.timeoutLeavesHistoryUnchanged).toBe(true)
      expect(result.running).toBe(0)
    } finally {
      if (child.exitCode === null) child.kill()
      await child.exited
    }
  },
  30_000,
)
