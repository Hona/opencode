import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Workspace } from "@opencode-ai/schema/workspace"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Effect, Layer, PlatformError } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const options = {
  database: { path: ":memory:" },
  models: { fetch: false },
  fs: { filewatcher: false },
} as const

it.live("location.get confirms missing and non-directory paths before loading location services", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-location-")))
    const file = path.join(tmp.path, "file")
    yield* Effect.promise(() => fs.writeFile(file, "not a directory"))
    const handler = yield* ServerFetch.make({ ...options, config: { directory: tmp.path, project: false } })
    yield* Effect.forEach([path.join(tmp.path, "missing"), file, path.join(file, "child")], (directory) =>
      Effect.gen(function* () {
        const url = new URL("http://opencode.local/api/location")
        url.searchParams.set("location[directory]", directory)
        const response = yield* Effect.promise(() => handler(new Request(url)))
        expect(response.status).toBe(404)
        expect(yield* Effect.promise(() => response.json())).toEqual({
          _tag: "LocationNotFoundError",
          directory,
          message: `Location directory not found: ${directory}`,
        })
      }),
    )
    const loaded = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/debug/location")))
    expect(yield* Effect.promise(() => loaded.json())).toEqual([])
  }),
)

it.live("location.get resolves existing directories and detects their later removal through headers", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-location-")))
    const directory = path.join(tmp.path, "project")
    yield* Effect.promise(() => fs.mkdir(directory))
    const handler = yield* ServerFetch.make({ ...options, config: { directory: tmp.path, project: false } })
    const request = () =>
      new Request("http://opencode.local/api/location", {
        headers: { "x-opencode-directory": encodeURIComponent(directory) },
      })
    const response = yield* Effect.promise(() => handler(request()))
    expect(response.status).toBe(200)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({ directory })
    yield* Effect.promise(() => fs.rm(directory, { recursive: true }))
    const missing = yield* Effect.promise(() => handler(request()))
    expect(missing.status).toBe(404)
    expect(yield* Effect.promise(() => missing.json())).toMatchObject({ _tag: "LocationNotFoundError", directory })
  }),
)

it.live("location.get does not classify permission, IO, symlink, or config failures as missing", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-location-")))
    const directory = path.join(tmp.path, "project")
    yield* Effect.promise(() => fs.mkdir(directory))
    yield* Effect.promise(() => fs.writeFile(path.join(directory, "opencode.json"), "{}"))
    const handler = yield* ServerFetch.make(
      { ...options, config: { directory: tmp.path } },
      {
        overrides: [
          FSUtil.node.replace(
            FSUtil.node.mapLayer((layer) =>
              Layer.effect(
                FSUtil.Service,
                Effect.map(FSUtil.Service, (fs) => ({
                  ...fs,
                  stat: (target: string) => {
                    const name = path.basename(target)
                    if (name !== "PermissionDenied" && name !== "Unknown" && name !== "BadResource")
                      return fs.stat(target)
                    return Effect.fail(
                      PlatformError.systemError({
                        _tag: name,
                        module: "FileSystem",
                        method: "stat",
                        cause: { code: name === "BadResource" ? "ELOOP" : "EIO" },
                      }),
                    )
                  },
                  readFileStringSafe: (target: string) =>
                    target === path.join(directory, "opencode.json")
                      ? Effect.fail(
                          PlatformError.systemError({
                            _tag: "Unknown",
                            module: "FileSystem",
                            method: "readFileString",
                          }),
                        )
                      : fs.readFileStringSafe(target),
                })),
              ).pipe(Layer.provide(layer)),
            ),
          ),
        ],
      },
    )
    yield* Effect.forEach(["PermissionDenied", "Unknown", "BadResource", "project"], (name) =>
      Effect.gen(function* () {
        const url = new URL("http://opencode.local/api/location")
        url.searchParams.set("location[directory]", path.join(tmp.path, name))
        const response = yield* Effect.promise(() => handler(new Request(url)))
        expect(response.status).toBe(500)
        expect(yield* Effect.promise(() => response.text())).not.toContain("LocationNotFoundError")
      }),
    )
  }),
)

it.live("location.get preserves workspace placement for paths absent on the host", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-location-")))
    const handler = yield* ServerFetch.make({ ...options, config: { directory: tmp.path, project: false } })
    const url = new URL("http://opencode.local/api/location")
    url.searchParams.set("location[directory]", path.join(tmp.path, "workspace-only"))
    const workspaceID = Workspace.ID.create()
    url.searchParams.set("location[workspace]", workspaceID)
    const response = yield* Effect.promise(() => handler(new Request(url)))
    expect(response.status).toBe(200)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({
      directory: path.join(tmp.path, "workspace-only"),
      workspaceID,
    })
  }),
)
