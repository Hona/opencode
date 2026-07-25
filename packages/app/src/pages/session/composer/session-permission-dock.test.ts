import { describe, expect, test } from "bun:test"
import { permissionAllowsAlways } from "./session-permission-dock"

describe("permissionAllowsAlways", () => {
  test("hides persistent approval when the request has no always patterns", () => {
    expect(permissionAllowsAlways({ always: [] })).toBe(false)
    expect(permissionAllowsAlways({ always: ["https://example.com/*"] })).toBe(true)
  })
})
