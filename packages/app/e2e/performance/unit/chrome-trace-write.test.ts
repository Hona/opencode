import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { prepareChromeTrace } from "../chrome-trace"

test("creates the configured trace directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-trace-"))
  try {
    expect(await prepareChromeTrace(path.join(root, "nested", "traces"), "session/tab", false)).toBe(
      path.join(root, "nested", "traces", "session-tab.json"),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
