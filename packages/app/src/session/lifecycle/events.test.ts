import { describe, expect, test } from "bun:test"
import { readSessionsUnavailable, SESSIONS_UNAVAILABLE_EVENT } from "./events"

describe("session lifecycle events", () => {
  test("reads valid unavailable session details", () => {
    expect(
      readSessionsUnavailable(
        new CustomEvent(SESSIONS_UNAVAILABLE_EVENT, {
          detail: { directory: "/tmp/project", sessionIDs: ["ses_1", "ses_2", 1], reason: "deleted" },
        }),
      ),
    ).toEqual({ directory: "/tmp/project", sessionIDs: ["ses_1", "ses_2"], reason: "deleted" })
  })

  test("ignores invalid unavailable session details", () => {
    expect(readSessionsUnavailable(new Event(SESSIONS_UNAVAILABLE_EVENT))).toBeUndefined()
    expect(
      readSessionsUnavailable(
        new CustomEvent(SESSIONS_UNAVAILABLE_EVENT, {
          detail: { directory: "/tmp/project", sessionIDs: [], reason: "deleted" },
        }),
      ),
    ).toBeUndefined()
    expect(
      readSessionsUnavailable(
        new CustomEvent(SESSIONS_UNAVAILABLE_EVENT, {
          detail: { directory: "/tmp/project", sessionIDs: ["ses_1"], reason: "unknown" },
        }),
      ),
    ).toBeUndefined()
  })
})
