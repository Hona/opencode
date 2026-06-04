import { describe, expect, test } from "bun:test"
import { readSessionTabsInvalidated, SESSION_TABS_INVALIDATED_EVENT } from "./events"

describe("session tab events", () => {
  test("reads valid invalidated session tabs", () => {
    expect(
      readSessionTabsInvalidated(
        new CustomEvent(SESSION_TABS_INVALIDATED_EVENT, {
          detail: { directory: "/tmp/project", sessionIDs: ["ses_1", "ses_2", 1] },
        }),
      ),
    ).toEqual({ directory: "/tmp/project", sessionIDs: ["ses_1", "ses_2"] })
  })

  test("ignores invalid invalidated session tabs", () => {
    expect(readSessionTabsInvalidated(new Event(SESSION_TABS_INVALIDATED_EVENT))).toBeUndefined()
    expect(
      readSessionTabsInvalidated(
        new CustomEvent(SESSION_TABS_INVALIDATED_EVENT, {
          detail: { directory: "/tmp/project", sessionIDs: [] },
        }),
      ),
    ).toBeUndefined()
  })
})
