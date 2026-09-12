import { devices, expect, test } from "@playwright/test"
import {
  assistantMessage,
  partUpdated,
  renderedPartID,
  setupTimeline,
  textPart,
  userMessage,
} from "../performance/timeline-stability/fixture"
import { reportVisualStability, startVisualProbe, stopVisualProbe, visualPlan } from "../utils/visual-stability"

// Compositor prediction can add 20–25px to discrete CDP moves even in a plain
// scrollport. Disable it so the visual assertion measures the supplied gesture.
test.use({ launchOptions: { args: ["--disable-features=ResamplingScrollEvents"] } })

for (const device of ["Pixel 7", "iPhone 13"]) {
  test.describe(device, () => {
    // Chromium drives native touch input, including the virtualizer's iOS user-agent path.
    test.use({
      isMobile: true,
      hasTouch: true,
      userAgent: devices[device].userAgent,
      viewport: { width: 390, height: 844 },
    })

    for (const direction of ["ltr", "rtl"]) {
      test(`session text follows each 50px finger movement (${direction})`, async ({ page }, testInfo) => {
        const messages = Array.from({ length: 40 }, (_, index) => {
          const id = `msg_${String(index).padStart(4, "0")}_mobile`
          return [
            userMessage(undefined, { id: `${id}_user`, created: 1690000000000 + index * 10_000 }),
            assistantMessage(
              [
                textPart(
                  `prt_mobile_${index}`,
                  `Answer ${index}. ${"Mobile history content. ".repeat(10 + (index % 4) * 20)}`,
                ),
              ],
              { id: `${id}_assistant`, parentID: `${id}_user`, created: 1690000001000 + index * 10_000 },
            ),
          ]
        }).flat()
        await setupTimeline(page, { messages, viewport: { width: 390, height: 844 } })
        await page.evaluate((direction) => (document.documentElement.dir = direction), direction)
        const timeline = page.locator('[data-slot="session-timeline-scroll"]')
        const scroller = timeline.getByRole("region", { name: "scrollable content", exact: true })
        await page.evaluate(() => document.fonts.ready)
        await expect(timeline.locator("[data-timeline-virtual-content]")).toBeVisible()
        await expect(page.getByText("Answer 39.", { exact: false })).toBeInViewport()
        await expect(timeline.locator('[data-component="markdown"]:not([data-markdown-ready])')).toHaveCount(0)
        const devtools = await page.context().newCDPSession(page)

        for (const [index, sign] of [1, 1, 1, -1, -1, -1].entries()) {
          const bounds = await scroller.boundingBox()
          expect(bounds).not.toBeNull()
          if (!bounds) return
          const partID = await scroller.evaluate((root, sign) => {
            const view = root.getBoundingClientRect()
            const line = sign > 0 ? view.top + 40 : view.bottom - 40
            return [...root.querySelectorAll<HTMLElement>("[data-timeline-part-id]")]
              .filter((part) => part.querySelector("p"))
              .map((part) => ({ part, rect: part.getBoundingClientRect() }))
              .filter(({ rect }) => rect.bottom > view.top && rect.top < view.bottom)
              .sort((a, b) => Math.abs(a.rect.top - line) - Math.abs(b.rect.top - line))[0]?.part.dataset.timelinePartId
          }, sign)
          expect(partID).toBeTruthy()
          const selector = `[data-timeline-part-id="${partID}"] p`
          const anchor = scroller.locator(selector)
          await expect(anchor).toHaveCount(1)
          const regions = { text: { selector } }
          await startVisualProbe(page, regions)
          const x = bounds.x + bounds.width / 3
          const y = bounds.y + (sign > 0 ? 60 : bounds.height - 60)
          await devtools.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] })
          // Cross the browser's touch slop before measuring one-to-one dragging.
          await devtools.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x, y: y + sign * 30 }],
          })
          await expect(timeline.locator('[data-orientation="vertical"][data-visible="true"]')).toHaveCount(1)
          await page.screenshot()
          const origin = await anchor.boundingBox()
          expect(origin).not.toBeNull()
          if (!origin) return
          for (let step = 1; step <= 8; step++) {
            await devtools.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ x, y: y + sign * (30 + step * 50) }],
            })
            await expect.poll(async () => (await anchor.boundingBox())?.y).toBeCloseTo(origin.y + sign * step * 50, 0)
          }
          await devtools.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
          // Include release and momentum corrections through the scroll indicator's idle state.
          await expect(timeline.locator('[data-orientation="vertical"][data-visible="false"]')).toHaveCount(1)
          await testInfo.attach(`swipe-${index}.png`, { body: await page.screenshot(), contentType: "image/png" })
          expect((await anchor.boundingBox())?.y).toBeCloseTo(origin.y + sign * 400, 0)
          const trace = await stopVisualProbe(page)
          await reportVisualStability(
            testInfo,
            `swipe-${index}`,
            trace,
            visualPlan(regions, [{ type: "motion", regions: "all", maxPositionReversals: 0 }]),
          )
        }
      })
    }

    test("reversing a touch drag stops following streamed output", async ({ page }, testInfo) => {
      const partID = "prt_mobile_stream"
      const content = Array.from({ length: 60 }, (_, index) => `Reading earlier output ${index}.\n\n`).join("")
      const timeline = await setupTimeline(page, {
        messages: [userMessage(), assistantMessage([textPart(partID, content)], { completed: false })],
        viewport: { width: 390, height: 844 },
      })
      const scroller = page
        .locator('[data-slot="session-timeline-scroll"]')
        .getByRole("region", { name: "scrollable content", exact: true })
      const part = page.locator(`[data-timeline-part-id="${renderedPartID(partID)}"]`)
      const anchor = part.getByText("Reading earlier output 59.", { exact: true })
      await page.evaluate(() => document.fonts.ready)
      await expect(scroller.locator("[data-timeline-virtual-content]")).toBeVisible()
      await expect(anchor).toBeInViewport()
      const bounds = await scroller.boundingBox()
      expect(bounds).not.toBeNull()
      if (!bounds) return
      const devtools = await page.context().newCDPSession(page)
      const x = bounds.x + bounds.width / 3
      const y = bounds.y + bounds.height * 0.75
      await devtools.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] })
      for (let step = 1; step <= 12; step++)
        await devtools.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - step * 10 }] })
      for (let step = 1; step <= 8; step++)
        await devtools.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y - 120 + step * 10 }],
        })
      const before = await anchor.boundingBox()
      expect(before).not.toBeNull()
      if (!before) return
      await timeline.send(
        partUpdated(textPart(partID, `${content}New streamed output.\n\n${"More output.\n\n".repeat(10)}`)),
      )
      await expect(part).toContainText("New streamed output.")
      await expect(part.locator('[data-component="markdown"]:not([data-markdown-ready])')).toHaveCount(0)
      await devtools.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
      await testInfo.attach("held-touch.png", { body: await page.screenshot(), contentType: "image/png" })
      expect((await anchor.boundingBox())?.y).toBeCloseTo(before.y, 0)
    })
  })
}
