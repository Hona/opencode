import { afterEach, describe, expect, test } from "bun:test"
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { trim } from "../src/observability/logging.js"

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function write(lines: number) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-logging-trim-"))
  dirs.push(dir)
  const file = path.join(dir, "opencode.log")
  await fs.writeFile(file, Array.from({ length: lines }, (_, i) => `line ${String(i).padStart(6, "0")}\n`).join(""))
  return file
}

const run = (file: string, options: { max: number; keep: number }) =>
  Effect.runPromise(trim(file, options).pipe(Effect.provide(NodeFileSystem.layer)))

describe("Logging.trim", () => {
  test("leaves a file at or below the limit alone", async () => {
    const file = await write(100)
    const before = await fs.readFile(file, "utf8")
    await run(file, { max: before.length, keep: 100 })
    expect(await fs.readFile(file, "utf8")).toBe(before)
  })

  test("keeps the tail, starting on a line boundary", async () => {
    const file = await write(10_000)
    const original = await fs.readFile(file, "utf8")
    // 12 bytes per line; a keep that is not a multiple of the line length forces a mid-line cut.
    await run(file, { max: 60_000, keep: 30_005 })
    const after = await fs.readFile(file, "utf8")
    expect(after.length).toBeLessThanOrEqual(30_005)
    expect(after.length).toBeGreaterThan(30_005 - 12)
    expect(after.startsWith("line ")).toBe(true)
    expect(original.endsWith(after)).toBe(true)
    expect(original.at(original.length - after.length - 1)).toBe("\n")
  })

  test("keeps nothing when the tail has no newline", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-logging-trim-"))
    dirs.push(dir)
    const file = path.join(dir, "opencode.log")
    await fs.writeFile(file, "x".repeat(1000))
    await run(file, { max: 500, keep: 100 })
    expect((await fs.stat(file)).size).toBe(0)
  })

  test("scans past a chunk boundary to find the line start", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-logging-trim-"))
    dirs.push(dir)
    const file = path.join(dir, "opencode.log")
    // One 200 KiB line followed by a short one: the newline is several read chunks past the cut.
    await fs.writeFile(file, "a".repeat(200 * 1024) + "\nlast\n")
    await run(file, { max: 1024, keep: 150 * 1024 })
    expect(await fs.readFile(file, "utf8")).toBe("last\n")
  })
})
