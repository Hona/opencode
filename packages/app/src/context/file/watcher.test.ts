import { describe, expect, test } from "bun:test"
import { filePathKey } from "./path"
import { invalidateFromWatcher } from "./watcher"

describe("file watcher invalidation", () => {
  test("reloads open files and refreshes loaded parent on add", () => {
    const loads: string[] = []
    const refresh: string[] = []
    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: "src/new.ts",
          event: "add",
        },
      },
      {
        normalize: (input) => input,
        file: (key) => (key === filePathKey("src/new.ts") ? "src/new.ts" : undefined),
        dir: (key) => (key === filePathKey("src") ? "src" : undefined),
        loadFile: (path) => loads.push(path),
        refreshDir: (path) => refresh.push(path),
      },
    )

    expect(loads).toEqual(["src/new.ts"])
    expect(refresh).toEqual(["src"])
  })

  test("matches loaded files and parents across slash variants", () => {
    const loads: string[] = []
    const refresh: string[] = []

    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: "src\\new.ts",
          event: "add",
        },
      },
      {
        normalize: (input) => input,
        file: (key) => (key === filePathKey("src/new.ts") ? "src/new.ts" : undefined),
        dir: (key) => (key === filePathKey("src") ? "src" : undefined),
        loadFile: (path) => loads.push(path),
        refreshDir: (path) => refresh.push(path),
      },
    )

    expect(loads).toEqual(["src/new.ts"])
    expect(refresh).toEqual(["src"])
  })

  test("reloads files that are open in tabs", () => {
    const loads: string[] = []

    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: "src/open.ts",
          event: "change",
        },
      },
      {
        normalize: (input) => input,
        file: () => undefined,
        open: (key) => (key === filePathKey("src/open.ts") ? "src/open.ts" : undefined),
        dir: () => undefined,
        loadFile: (path) => loads.push(path),
        refreshDir: () => {},
      },
    )

    expect(loads).toEqual(["src/open.ts"])
  })

  test("refreshes only changed loaded directory nodes", () => {
    const refresh: string[] = []

    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: "src",
          event: "change",
        },
      },
      {
        normalize: (input) => input,
        file: () => undefined,
        dir: (key) => (key === filePathKey("src") ? "src" : undefined),
        loadFile: () => {},
        refreshDir: (path) => refresh.push(path),
      },
    )

    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: "src/file.ts",
          event: "change",
        },
      },
      {
        normalize: (input) => input,
        file: () => undefined,
        dir: () => undefined,
        loadFile: () => {},
        refreshDir: (path) => refresh.push(path),
      },
    )

    expect(refresh).toEqual(["src"])
  })

  test("refreshes changed directories across slash variants", () => {
    const refresh: string[] = []

    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: "src\\nested",
          event: "change",
        },
      },
      {
        normalize: (input) => input,
        file: () => undefined,
        dir: (key) => (key === filePathKey("src/nested") ? "src/nested" : undefined),
        loadFile: () => {},
        refreshDir: (path) => refresh.push(path),
      },
    )

    expect(refresh).toEqual(["src/nested"])
  })

  test("ignores invalid or git watcher updates", () => {
    const refresh: string[] = []

    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: ".git/index.lock",
          event: "change",
        },
      },
      {
        normalize: (input) => input,
        file: () => "src/a.ts",
        dir: () => "src",
        loadFile: () => {
          throw new Error("should not load")
        },
        refreshDir: (path) => refresh.push(path),
      },
    )

    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: ".git\\index.lock",
          event: "change",
        },
      },
      {
        normalize: (input) => input,
        file: () => "src/a.ts",
        dir: () => "src",
        loadFile: () => {
          throw new Error("should not load")
        },
        refreshDir: (path) => refresh.push(path),
      },
    )

    invalidateFromWatcher(
      {
        type: "project.updated",
        properties: {},
      },
      {
        normalize: (input) => input,
        file: () => undefined,
        dir: () => "src",
        loadFile: () => {},
        refreshDir: (path) => refresh.push(path),
      },
    )

    expect(refresh).toEqual([])
  })
})
