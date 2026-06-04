import { describe, expect, test } from "bun:test"
import type { PermissionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { autoRespondsPermission, isDirectoryAutoAccepting, isServerAutoAccepting, serverAcceptKey } from "./permission-auto-respond"

const session = (input: { id: string; parentID?: string }) =>
  ({
    id: input.id,
    parentID: input.parentID,
  }) as Session

const permission = (sessionID: string) =>
  ({
    sessionID,
  }) as Pick<PermissionRequest, "sessionID">

describe("autoRespondsPermission", () => {
  test("uses a parent session's directory-scoped auto-accept", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/root`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(true)
  })

  test("uses a parent session's legacy auto-accept key", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]

    expect(autoRespondsPermission({ root: true }, sessions, permission("child"), "/tmp/project")).toBe(true)
  })

  test("defaults to requiring approval when no lineage override exists", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" }), session({ id: "other" })]
    const autoAccept = {
      other: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), "/tmp/project")).toBe(false)
  })

  test("inherits a parent session's false override", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/root`]: false,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(false)
  })

  test("prefers a child override over parent override", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/root`]: false,
      [`${base64Encode(directory)}/child`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(true)
  })

  test("falls back to directory-level auto-accept", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/*`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("root"), directory)).toBe(true)
  })

  test("session-level override takes precedence over directory-level", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/*`]: true,
      [`${base64Encode(directory)}/root`]: false,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("root"), directory)).toBe(false)
  })

  test("falls back to server-level auto-accept", () => {
    const server = "http://localhost:4096"
    expect(
      autoRespondsPermission({ [serverAcceptKey(server)]: true }, [session({ id: "root" })], permission("root"), "/tmp/project", server),
    ).toBe(true)
  })

  test("does not apply another server's auto-accept", () => {
    expect(
      autoRespondsPermission(
        { [serverAcceptKey("http://localhost:4096")]: true },
        [session({ id: "root" })],
        permission("root"),
        "/tmp/project",
        "http://localhost:4097",
      ),
    ).toBe(false)
  })

  test("session-level override takes precedence over server-level auto-accept", () => {
    const directory = "/tmp/project"
    const server = "http://localhost:4096"
    const autoAccept = {
      [serverAcceptKey(server)]: true,
      [`${base64Encode(directory)}/root`]: false,
    }

    expect(autoRespondsPermission(autoAccept, [session({ id: "root" })], permission("root"), directory, server)).toBe(false)
  })
})

describe("isDirectoryAutoAccepting", () => {
  test("returns true when directory key is set", () => {
    const directory = "/tmp/project"
    const autoAccept = { [`${base64Encode(directory)}/*`]: true }
    expect(isDirectoryAutoAccepting(autoAccept, directory)).toBe(true)
  })

  test("returns false when directory key is not set", () => {
    expect(isDirectoryAutoAccepting({}, "/tmp/project")).toBe(false)
  })

  test("returns false when directory key is explicitly false", () => {
    const directory = "/tmp/project"
    const autoAccept = { [`${base64Encode(directory)}/*`]: false }
    expect(isDirectoryAutoAccepting(autoAccept, directory)).toBe(false)
  })

  test("falls back to server-level auto-accept", () => {
    const server = "http://localhost:4096"
    expect(isDirectoryAutoAccepting({ [serverAcceptKey(server)]: true }, "/tmp/project", server)).toBe(true)
  })

  test("prefers a directory override over server-level auto-accept", () => {
    const directory = "/tmp/project"
    const server = "http://localhost:4096"
    expect(isDirectoryAutoAccepting({ [serverAcceptKey(server)]: true, [`${base64Encode(directory)}/*`]: false }, directory, server)).toBe(false)
  })
})

describe("isServerAutoAccepting", () => {
  test("returns the server wildcard value", () => {
    const server = "http://localhost:4096"
    expect(isServerAutoAccepting({ [serverAcceptKey(server)]: true }, server)).toBe(true)
  })

  test("ignores narrower auto-accept entries", () => {
    expect(isServerAutoAccepting({ [`${base64Encode("/tmp/project")}/*`]: true }, "http://localhost:4096")).toBe(false)
  })
})
