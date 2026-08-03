import { describe, expect, test } from "bun:test"
import { ServerScope } from "./server-scope"
import { Persist, PersistTesting } from "./persist"

describe("Persist addresses", () => {
  test("normalizer rejects malformed JSON payloads", () => {
    expect(PersistTesting.normalize({ value: "ok" }, '{"value":"\\x"}')).toBeUndefined()
  })

  test("workspace storage sanitizes Windows filename characters", () => {
    const result = PersistTesting.workspaceStorage("C:\\Users\\foo")
    expect(result).toStartWith("opencode.workspace.")
    expect(result.endsWith(".dat")).toBeTrue()
    expect(/[:\\/]/.test(result)).toBeFalse()
  })

  test("workspace target keeps path variants as legacy addresses", () => {
    const target = Persist.workspace("C:\\Users\\foo", "vcs")
    expect(target.storage).toBe(PersistTesting.workspaceStorage("C:/Users/foo"))
    expect(target.legacyStorageNames).toEqual([PersistTesting.workspaceStorage("C:\\Users\\foo")])
  })

  test("draft target isolates storage and namespaces keys", () => {
    const first = Persist.draft("draft-a", "prompt")
    const second = Persist.draft("draft-b", "prompt")
    expect(first.key).toBe("draft:prompt")
    expect(first.storage).not.toBe(second.storage)
  })

  test("server targets preserve local addresses and isolate remote scopes", () => {
    const local = Persist.serverWorkspace(ServerScope.local, "/home/luke/repo", "prompt")
    const remote = Persist.serverWorkspace("https://debian.example" as ServerScope, "/home/luke/repo", "prompt")
    expect(local).toEqual(Persist.workspace("/home/luke/repo", "prompt"))
    expect(remote.storage).not.toBe(local.storage)
    expect(remote.legacyStorageNames).toBeUndefined()
  })
})
