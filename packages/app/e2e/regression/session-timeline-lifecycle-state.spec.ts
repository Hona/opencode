import { expect, test } from "@playwright/test"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"
import {
  assistantMessage,
  partUpdated,
  reasoningPart,
  renderedPartID,
  setupTimeline,
  status,
  userMessage,
} from "../performance/timeline-stability/fixture"

for (const transition of ["reasoning-end", "idle", "retry"] as const) {
  test(`stops active Thinking on ${transition} without a following tool`, async ({ page }) => {
    const id = `prt_reasoning_stop_${transition}`
    const text = "## Inspecting stability\n\nThe timeline is ready for the next step."
    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistantMessage([reasoningPart(id, text)], { completed: false })],
      settings: {
        timelineDetail: { ...timelinePresets[2].value, thinking: { placement: "separate", details: "collapsed" } },
      },
    })
    const part = page.locator(`[data-timeline-part-id="${renderedPartID(id)}"]`)
    const trigger = part.locator('[data-slot="collapsible-trigger"]')
    await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await timeline.send(transition === "reasoning-end" ? partUpdated(reasoningPart(id, text)) : status(transition))
    await expect(trigger).toContainText("Thought")
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
    await expect(page.locator('[data-timeline-row="Retry"]')).toHaveCount(transition === "retry" ? 1 : 0)
    await trigger.click()
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await expect(part.getByText("The timeline is ready for the next step.", { exact: true })).toBeVisible()
  })
}
