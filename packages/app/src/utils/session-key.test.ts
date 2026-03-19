import { describe, expect, test } from "bun:test"
import { base64Encode } from "@opencode-ai/util/encode"
import { sessionDirKey, sessionKey, sessionParts } from "./session-key"

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
})
