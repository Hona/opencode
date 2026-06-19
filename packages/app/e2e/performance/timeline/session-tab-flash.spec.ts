import { benchmark, expect } from "../benchmark"
import { expectSessionTitle } from "../../utils/waits"
import { fixture } from "./session-timeline-stress.fixture"
import {
  collectCachedRepaintTrace,
  compressCachedRepaintTrace,
  installCachedRepaintProbe,
} from "./session-tab-repaint-probe"
import {
  installStressSessionTabs,
  installTimelineSettings,
  mockStressTimeline,
  stressSessionHref,
} from "./timeline-test-helpers"

benchmark("traces cached session repaint after the correct first frame", async ({ page, report }) => {
  benchmark.setTimeout(120_000)
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

  await installCachedRepaintProbe(page, {
    targetHref: stressSessionHref(fixture.targetID),
    destination: fixture.messages[fixture.targetID].map((message) => message.info.id),
    last: fixture.expected.targetMessageIDs.at(-1)!,
  })

  await page
    .locator(`[data-slot="titlebar-tabs"] a[href="${stressSessionHref(fixture.targetID)}"]`)
    .first()
    .click()
  await expectSessionTitle(page, fixture.expected.targetTitle)
  await page.waitForTimeout(1_000)
  const result = await collectCachedRepaintTrace(page)
  report(compressCachedRepaintTrace(result))
  expect(result.frames.length).toBeGreaterThan(0)
})
