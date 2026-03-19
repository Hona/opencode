import { describe, expect, test } from "bun:test"
import { filePathKey } from "./path"
import { createFileTreeStore } from "./tree-store"

describe("file tree store path handling", () => {
  test("normalizes node and directory keys across slash variants", async () => {
    const normalize = (input: string) => input.replace(/\\/g, "/").replace(/[\\/]+$/, "")
    const tree = createFileTreeStore({
      scope: () => "/repo",
      normalize,
      normalizeDir: normalize,
      list: async (input) => {
        if (!input) {
          return [
            { name: "src", path: "src\\core", absolute: "src\\core", type: "directory", ignored: false },
            { name: "app.ts", path: "src\\app.ts", absolute: "src\\app.ts", type: "file", ignored: false },
          ]
        }

        return [{ name: "util.ts", path: "src/core\\util.ts", absolute: "src/core\\util.ts", type: "file", ignored: false }]
      },
      onError() {},
    })

    await tree.listDir("")

    expect(tree.children("").map((node) => node.path)).toEqual(["src/core", "src/app.ts"])
    expect(tree.node("src\\app.ts")?.path).toBe("src/app.ts")
    expect(tree.dirPathByKey(filePathKey(""))).toBe("")

    tree.expandDir("src\\core")
    expect(tree.dirState("src/core")?.expanded).toBe(true)

    await tree.listDir("src/core")
    expect(tree.children("src\\core").map((node) => node.path)).toEqual(["src/core/util.ts"])
    expect(tree.dirPathByKey(filePathKey("src\\core"))).toBe("src/core")

    tree.collapseDir("src/core")
    expect(tree.dirState("src\\core")?.expanded).toBe(false)
  })
})
