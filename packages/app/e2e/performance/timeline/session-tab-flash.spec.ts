import { expect, test } from "@playwright/test"
import { expectSessionTitle } from "../../utils/waits"
import { fixture } from "./session-timeline-stress.fixture"
import {
  installStressSessionTabs,
  installTimelineSettings,
  mockStressTimeline,
  stressSessionHref,
} from "./timeline-test-helpers"

test("traces cached session repaint after the correct first frame", async ({ page }) => {
  test.setTimeout(120_000)
  await mockStressTimeline(page)
  await installStressSessionTabs(page)
  await installTimelineSettings(page)
  await page.goto(stressSessionHref(fixture.targetID))
  await expectSessionTitle(page, fixture.expected.targetTitle)
  await page.waitForTimeout(1_000)
  await page
    .locator(`[data-slot="titlebar-tabs"] a[href="${stressSessionHref(fixture.sourceID)}"]`)
    .first()
    .click()
  await expectSessionTitle(page, fixture.expected.sourceTitle)

  const destination = new Set(fixture.messages[fixture.targetID].map((message) => message.info.id))
  const last = fixture.expected.targetMessageIDs.at(-1)!
  await page.evaluate(
    ({ targetHref, destination, last }) => {
      const ids = new Set(destination)
      const nodeIDs = new WeakMap<Node, number>()
      let nextNodeID = 1
      const id = (node: Node) => {
        const current = nodeIDs.get(node)
        if (current) return current
        nodeIDs.set(node, nextNodeID)
        return nextNodeID++
      }
      const state = {
        started: 0,
        frames: [] as unknown[],
        mutations: [] as unknown[],
        shifts: [] as unknown[],
        running: false,
      }
      new PerformanceObserver((entries) => {
        if (!state.running) return
        state.shifts.push(
          ...entries.getEntries().map((entry) => ({
            at: performance.now() - state.started,
            value: (entry as PerformanceEntry & { value: number }).value,
          })),
        )
      }).observe({ type: "layout-shift" })
      new MutationObserver((entries) => {
        if (!state.running) return
        const changed = entries.flatMap((entry) => [
          ...[...entry.addedNodes].map((node) => ({ type: "add", node: id(node) })),
          ...[...entry.removedNodes].map((node) => ({ type: "remove", node: id(node) })),
        ])
        if (changed.length) state.mutations.push({ at: performance.now() - state.started, changed })
      }).observe(document.documentElement, { childList: true, subtree: true })
      const sample = () => {
        if (!state.running) return
        setTimeout(() => {
          if (!state.running) return
          const root = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((element) =>
            element.querySelector("[data-timeline-row]"),
          )
          if (root) {
            const view = root.getBoundingClientRect()
            const rows = [...root.querySelectorAll<HTMLElement>("[data-timeline-key]")]
              .map((element) => ({
                key: element.dataset.timelineKey,
                node: id(element),
                rect: element.getBoundingClientRect(),
              }))
              .filter((item) => item.rect.bottom > view.top && item.rect.top < view.bottom)
              .map((item) => ({
                key: item.key,
                node: item.node,
                top: item.rect.top - view.top,
                bottom: item.rect.bottom - view.top,
              }))
            const messages = [...root.querySelectorAll<HTMLElement>("[data-message-id]")]
              .filter((element) => {
                const rect = element.getBoundingClientRect()
                return rect.bottom > view.top && rect.top < view.bottom
              })
              .map((element) => element.dataset.messageId!)
              .filter((messageID) => ids.has(messageID))
            const spacer = root
              .querySelector<HTMLElement>('[data-timeline-row="bottom-spacer"]')
              ?.getBoundingClientRect()
            state.frames.push({
              at: performance.now() - state.started,
              root: id(root),
              scrollTop: root.scrollTop,
              scrollHeight: root.scrollHeight,
              bottomError: spacer ? spacer.bottom - view.bottom : undefined,
              last: messages.includes(last),
              rows,
              mounted: root.querySelectorAll("[data-timeline-key]").length,
              center: document
                .elementFromPoint(view.left + view.width / 2, view.top + view.height / 2)
                ?.textContent?.slice(0, 80),
            })
          }
          requestAnimationFrame(sample)
        }, 0)
      }
      document.addEventListener(
        "click",
        (event) => {
          const link = event.target instanceof Element ? event.target.closest("a") : undefined
          if (link?.getAttribute("href") !== targetHref) return
          state.started = performance.now()
          state.running = true
          requestAnimationFrame(sample)
        },
        { capture: true, once: true },
      )
      ;(window as Window & { __cachedFlash?: typeof state }).__cachedFlash = state
    },
    { targetHref: stressSessionHref(fixture.targetID), destination: [...destination], last },
  )

  await page
    .locator(`[data-slot="titlebar-tabs"] a[href="${stressSessionHref(fixture.targetID)}"]`)
    .first()
    .click()
  await expectSessionTitle(page, fixture.expected.targetTitle)
  await page.waitForTimeout(1_000)
  const result = await page.evaluate(() => {
    const state = (
      window as Window & {
        __cachedFlash?: { running: boolean; frames: unknown[]; mutations: unknown[]; shifts: unknown[] }
      }
    ).__cachedFlash!
    state.running = false
    return state
  })
  console.log("cached tab flash trace", JSON.stringify(result))
  expect(result.frames.length).toBeGreaterThan(10)
})
