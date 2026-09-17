import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect, Schedule } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

it.live(
  "browsing parents and siblings reuses the current Location and its MCP process",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const current = path.join(tmp.path, "root", "current")
      const starts = path.join(tmp.path, "starts")
      yield* Effect.promise(async () => {
        await fs.mkdir(current, { recursive: true })
        await fs.mkdir(path.join(tmp.path, "root", ".git"))
        await fs.mkdir(path.join(tmp.path, "root", "sibling", "nested"), { recursive: true })
        await fs.writeFile(path.join(tmp.path, "root", "sibling", "file.txt"), "outside")
        await fs.writeFile(starts, "")
        await fs.writeFile(
          path.join(tmp.path, "root", "opencode.json"),
          JSON.stringify({
            mcp: {
              servers: {
                filesystem: {
                  type: "local",
                  command: [process.execPath, path.join(import.meta.dir, "fixture", "mcp-starts.cjs"), starts],
                },
              },
            },
          }),
        )
      })
      const server = yield* startServer(path.join(tmp.path, "config"))
      const list = (directory: string) =>
        Effect.promise(async () => {
          const url = new URL("/api/fs/list", server.base)
          url.searchParams.set("location[directory]", current)
          url.searchParams.set("path", directory)
          const response = await fetch(url, { headers: server.headers })
          expect(response.status).toBe(200)
          const result = await response.json()
          expect(result.location.directory).toBe(current)
          return result.data
        })
      const loaded = Effect.promise(async () => {
        const response = await fetch(new URL("/api/debug/location", server.base), { headers: server.headers })
        expect(response.status).toBe(200)
        return response.json()
      })
      const count = Effect.promise(
        async () => (await fs.readFile(starts, "utf8")).trim().split("\n").filter(Boolean).length,
      )

      yield* list(".")
      expect(yield* loaded).toEqual([{ directory: current }])
      expect(
        yield* count.pipe(
          Effect.repeat({ while: (n) => n === 0, schedule: Schedule.spaced("25 millis") }),
          Effect.timeout("5 seconds"),
        ),
      ).toBe(1)

      yield* list("..")
      const sibling = yield* list("../sibling")
      expect(sibling).toEqual([
        { path: path.join("..", "sibling", "nested") + path.sep, type: "directory" },
        { path: path.join("..", "sibling", "file.txt"), type: "file" },
      ])
      expect(yield* list(path.join(tmp.path, "root", "sibling"))).toEqual(sibling)
      yield* list("../sibling/nested")
      yield* list("../sibling")
      expect(yield* loaded).toEqual([{ directory: current }])
      expect(yield* count).toBe(1)
    }),
  15_000,
)

it.live(
  "write stores binary files at absolute paths outside the location and at relative paths inside it",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const current = path.join(tmp.path, "project")
      yield* Effect.promise(() => fs.mkdir(current, { recursive: true }))
      const server = yield* startServer(path.join(tmp.path, "config"))
      const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])
      const write = (target: string) =>
        Effect.promise(async () => {
          const url = new URL("/api/fs/write", server.base)
          url.searchParams.set("location[directory]", current)
          const response = await fetch(url, {
            method: "POST",
            headers: { ...server.headers, "content-type": "application/json" },
            body: JSON.stringify({ path: target, data: Buffer.from(bytes).toString("base64") }),
          })
          expect(response.status).toBe(200)
          const result = await response.json()
          expect(result.location.directory).toBe(current)
          return result.data.path as string
        })

      // Mixed separators arrive from clients on another OS; the server resolves them.
      const outside = yield* write(`${tmp.path}/staged/nested/archive.zip`)
      expect(outside).toBe(path.join(tmp.path, "staged", "nested", "archive.zip"))
      expect(new Uint8Array(yield* Effect.promise(() => fs.readFile(outside)))).toEqual(bytes)

      const inside = yield* write(path.join("nested", "archive.zip"))
      expect(inside).toBe(path.join(current, "nested", "archive.zip"))
      expect(new Uint8Array(yield* Effect.promise(() => fs.readFile(inside)))).toEqual(bytes)
    }),
  15_000,
)
