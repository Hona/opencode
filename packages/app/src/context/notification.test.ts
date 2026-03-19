import { describe, expect, test } from "bun:test"
import { buildNotificationIndex, migrateNotifications, type Notification } from "./notification-state"

describe("notification directory normalization", () => {
  test("indexes equivalent project paths together", () => {
    const list: Notification[] = [
      { type: "turn-complete", directory: "C:/Repo", session: "ses_1", time: 1, viewed: false },
      {
        type: "error",
        directory: "c:\\repo\\",
        session: "ses_2",
        time: 2,
        viewed: false,
        error: { name: "UnknownError", data: { message: "boom" } },
      },
    ]

    const index = buildNotificationIndex(list)

    expect(index.project.unseenCount["c:/repo"]).toBe(2)
    expect(index.project.unseenHasError["c:/repo"]).toBe(true)
    expect(index.project.all["c:/repo"].map((item) => item.directory)).toEqual(["C:/Repo", "c:\\repo\\"])
  })

  test("preserves stored notification directory values during migration", () => {
    expect(migrateNotifications({ list: [{ type: "turn-complete", directory: "C:\\Repo\\", time: 1, viewed: true }] })).toEqual({
      list: [{ type: "turn-complete", directory: "C:\\Repo\\", time: 1, viewed: true }],
    })
  })
})
