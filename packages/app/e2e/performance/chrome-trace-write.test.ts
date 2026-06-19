import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { writeChromeTrace } from "./chrome-trace"

test("creates the configured trace directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-trace-"))
  const directory = path.join(root, "nested", "traces")
  const file = await writeChromeTrace(directory, "session/tab", [{ name: "event" }], false)

  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ traceEvents: [{ name: "event" }] })
  await rm(root, { recursive: true, force: true })
})
