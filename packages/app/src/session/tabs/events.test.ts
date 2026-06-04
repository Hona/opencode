import { describe, expect, test } from "bun:test"
import { publishSessionTabsInvalidated, readSessionTabsInvalidated, SESSION_TABS_INVALIDATED_EVENT } from "./events"

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

  test("publishes invalidated session tabs", () => {
    const events: Event[] = []
    const listen = (event: Event) => events.push(event)
    window.addEventListener(SESSION_TABS_INVALIDATED_EVENT, listen)

    publishSessionTabsInvalidated({ directory: "/tmp/project", sessionIDs: ["root", "child"] })

    window.removeEventListener(SESSION_TABS_INVALIDATED_EVENT, listen)
    expect(events.map(readSessionTabsInvalidated)).toEqual([{ directory: "/tmp/project", sessionIDs: ["root", "child"] }])
  })
})
