import { describe, expect, test } from "bun:test"

import { WorkspaceID } from "../../src/control-plane/schema"
import { PrettyPath } from "../../src/path/schema"

describe("runtime-safe path/id constructors", () => {
  test("parses branded ids and rejects invalid prefixes", () => {
    expect(String(WorkspaceID.parse("wrk_test_workspace"))).toBe("wrk_test_workspace")
    expect(() => WorkspaceID.parse("workspace_test_workspace")).toThrow(
      'Expected workspace id starting with "wrk"',
    )
  })

  test("rejects relative pretty paths", () => {
    expect(() => PrettyPath.parse("relative/path")).toThrow('Expected absolute filesystem path, received "relative/path"')
  })
})
