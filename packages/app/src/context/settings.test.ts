import { describe, expect, test } from "bun:test"
import { migrateSettings } from "./settings"

describe("migrateSettings", () => {
  test("migrates queued followups while preserving the remaining settings", () => {
    expect(
      migrateSettings({
        general: { followup: "queue", autoSave: false },
        appearance: { fontSize: 16 },
      }),
    ).toEqual({
      general: { followup: "steer", autoSave: false },
      appearance: { fontSize: 16 },
    })
  })

  test("leaves current and malformed values unchanged", () => {
    const current = { general: { followup: "steer" } }
    expect(migrateSettings(current)).toBe(current)
    expect(migrateSettings(null)).toBeNull()
  })
})
