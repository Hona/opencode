import { describe, expect, test } from "bun:test"
import { base64Encode } from "@opencode-ai/util/encode"
import {
  normalizeSessionKey,
  sessionDirKey,
  sessionKey,
  sessionParts,
  sessionPathHelpers,
  sessionScopeKey,
  sessionScopeParts,
} from "./session-key"

describe("session-key", () => {
  test("normalizes equivalent workspace aliases to one session key", () => {
    expect(sessionDirKey(base64Encode("C:\\Repo\\"))).toBe(sessionDirKey(base64Encode("c:/repo")))
    expect(sessionKey(base64Encode("C:\\Repo\\"), "one")).toBe(sessionKey(base64Encode("c:/repo"), "one"))
    expect(sessionParts(sessionKey(base64Encode("C:\\Repo\\"), "one"))).toEqual({
      dir: base64Encode("c:/repo"),
      directory: "c:/repo",
      id: "one",
      key: `${base64Encode("c:/repo")}/one`,
    })
  })

  test("builds path helpers from normalized session keys", () => {
    const path = sessionPathHelpers(sessionKey(base64Encode("C:\\Repo\\"), "one"))
    expect(path?.normalizeTab("file://src\\a.ts")).toBe("tab:file:src/a.ts")
  })

  test("normalizes equivalent inputs through one helper", () => {
    expect(normalizeSessionKey(sessionKey(base64Encode("C:\\Repo\\"), "one"))).toBe(
      normalizeSessionKey(sessionKey(base64Encode("c:/repo"), "one")),
    )
  })

  test("builds cache scope keys with explicit workspace fallback", () => {
    expect(sessionScopeKey("/repo")).toBe("/repo\n__workspace__")
    expect(sessionScopeParts(sessionScopeKey("/repo", "one"))).toEqual({ dir: "/repo", id: "one" })
    expect(sessionScopeParts(sessionScopeKey("/repo"))).toEqual({ dir: "/repo", id: undefined })
  })
})
