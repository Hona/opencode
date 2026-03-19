import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { base64Encode } from "@opencode-ai/util/encode"
import { createSessionKeyReader, ensureSessionKey, normalizeStoredSessionTabs, pruneSessionKeys } from "./layout"

describe("layout session-key helpers", () => {
  test("couples touch and scroll seed in order", () => {
    const calls: string[] = []
    const result = ensureSessionKey(
      "dir/a",
      (key) => calls.push(`touch:${key}`),
      (key) => calls.push(`seed:${key}`),
    )

    expect(result).toBe("dir/a")
    expect(calls).toEqual(["touch:dir/a", "seed:dir/a"])
  })

  test("reads dynamic accessor keys lazily", () => {
    const seen: string[] = []

    createRoot((dispose) => {
      const [key, setKey] = createSignal(`${base64Encode("C:\\Repo\\")}/one`)
      const read = createSessionKeyReader(key, (value) => {
        seen.push(value)
        return ensureSessionKey(value, () => {}, () => {})
      })

      expect(read()).toBe(`${base64Encode("c:/repo")}/one`)
      setKey(`${base64Encode("C:\\Repo\\")}/two`)
      expect(read()).toBe(`${base64Encode("c:/repo")}/two`)

      dispose()
    })

    expect(seen).toEqual([`${base64Encode("C:\\Repo\\")}/one`, `${base64Encode("C:\\Repo\\")}/two`])
  })
})

describe("pruneSessionKeys", () => {
  test("keeps active key and drops lowest-used keys", () => {
    const drop = pruneSessionKeys({
      keep: "k4",
      max: 3,
      used: new Map([
        ["k1", 1],
        ["k2", 2],
        ["k3", 3],
        ["k4", 4],
      ]),
      view: ["k1", "k2", "k4"],
      tabs: ["k1", "k3", "k4"],
    })

    expect(drop).toEqual(["k1"])
    expect(drop.includes("k4")).toBe(false)
  })

  test("does not prune without keep key", () => {
    const drop = pruneSessionKeys({
      keep: undefined,
      max: 1,
      used: new Map([
        ["k1", 1],
        ["k2", 2],
      ]),
      view: ["k1"],
      tabs: ["k2"],
    })

    expect(drop).toEqual([])
  })
})

describe("normalizeStoredSessionTabs", () => {
  test("upgrades legacy file tabs without touching real file URIs", () => {
    const key = `${base64Encode("/repo")}/session`

    expect(
      normalizeStoredSessionTabs(key, {
        all: ["context", "file://src/a.ts", "tab:file:src/a.ts", "file:///repo/src/b.ts"],
        active: "file://src/a.ts",
      }),
    ).toEqual({
      all: ["context", "tab:file:src/a.ts", "file:///repo/src/b.ts"],
      active: "tab:file:src/a.ts",
    })
  })
})
