import { describe, expect, test } from "bun:test"
import { searchFiles } from "./search"

describe("file search", () => {
  test("maps v2 filesystem entries without changing backend order", async () => {
    const requests: unknown[] = []
    const client = {
      v2: {
        fs: {
          find: async (input: unknown) => {
            requests.push(input)
            return {
              data: {
                data: [{ path: "src\\second.ts" }, { path: "src/first.ts" }],
              },
            }
          },
        },
      },
    }

    const result = await searchFiles(client, (path) => path.replaceAll("\\", "/"), "src", "file")

    expect(requests).toEqual([{ query: "src", type: "file", limit: "10" }])
    expect(result).toEqual(["src/second.ts", "src/first.ts"])
  })

  test("searches files and directories without a type restriction", async () => {
    const requests: unknown[] = []
    const client = {
      v2: {
        fs: {
          find: async (input: unknown) => {
            requests.push(input)
            return { data: { data: [] } }
          },
        },
      },
    }

    await searchFiles(client, (path) => path, "src")

    expect(requests).toEqual([{ query: "src", type: undefined, limit: "10" }])
  })

  test("returns no results when search fails", async () => {
    const client = {
      v2: {
        fs: {
          find: async () => {
            throw new Error("offline")
          },
        },
      },
    }

    expect(await searchFiles(client, (path) => path, "src")).toEqual([])
  })
})
