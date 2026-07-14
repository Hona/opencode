import { describe, expect, test } from "bun:test"
import { tabsInfoDate, tabsInfoWorktreeCopy } from "./help-button-content"

describe("tabs info drawer", () => {
  test("shows the rollout date and worktree copy", () => {
    expect(tabsInfoDate).toBe("July 14")
    expect(tabsInfoWorktreeCopy).toBe(
      "The new design does not support Git Worktrees yet, it's coming soon. So if you'd prefer to continue using the previous layout you can switch between layouts in Settings. Just keep in mind that the new layout will become permanent in a few weeks.",
    )
  })
})
