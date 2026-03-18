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
  })

  test("migrates persisted notifications onto normalized directory keys", () => {
    expect(migrateNotifications({ list: [{ type: "turn-complete", directory: "C:\\Repo\\", time: 1, viewed: true }] })).toEqual({
      list: [{ type: "turn-complete", directory: "c:/repo", time: 1, viewed: true }],
    })
  })
})
