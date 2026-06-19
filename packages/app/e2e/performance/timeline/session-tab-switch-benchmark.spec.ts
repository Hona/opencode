import type { Browser, Page } from "@playwright/test"
import { expectSessionTitle } from "../../utils/waits"
import { benchmark, expect, observePerformancePage } from "../benchmark"
import { fixture } from "./session-timeline-stress.fixture"
import { installStressSessionTabs, mockStressTimeline, stressSessionHref } from "./timeline-test-helpers"
import {
  collectSessionSwitchResult,
  installSessionSwitchProbe,
  waitForCachedDestination,
  waitForStableSessionSwitch,
} from "./session-tab-switch-probe"

type Result = Awaited<ReturnType<typeof collectSessionSwitchResult>>

benchmark("benchmarks cold and hot session tab switching", async ({ browser, report }) => {
  benchmark.setTimeout(180_000)
  const results = { cold: [] as Result[], hot: [] as Result[] }
  for (const mode of ["cold", "hot"] as const) {
    for (let run = 0; run < 5; run++) results[mode].push(await trial(browser, mode, run))
  }
  report({ results, summary: summarize(results) })
})

async function trial(browser: Browser, mode: "cold" | "hot", run: number) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const diagnostics = await observePerformancePage(page, `session-tab-switch-${mode}-${run}`)
  await mockStressTimeline(page)
  await installStressSessionTabs(page)
  if (mode === "hot") {
    await page.goto(stressSessionHref(fixture.targetID))
    await expectSessionTitle(page, fixture.expected.targetTitle)
    await waitForCachedDestination(page, fixture.expected.targetMessageIDs.at(-1)!)
    await switchSession(page, fixture.sourceID, fixture.expected.sourceTitle)
  } else {
    await page.goto(stressSessionHref(fixture.sourceID))
    await expectSessionTitle(page, fixture.expected.sourceTitle)
  }

  const destinationIDs = fixture.messages[fixture.targetID].map((message) => message.info.id)
  const sourceIDs = fixture.messages[fixture.sourceID].map((message) => message.info.id)
  const lastID = fixture.expected.targetMessageIDs.at(-1)!
  const href = stressSessionHref(fixture.targetID)
  await installSessionSwitchProbe(page, { destinationIDs, sourceIDs, lastID, href })

  await switchSession(page, fixture.targetID, fixture.expected.targetTitle)
  await waitForStableSessionSwitch(page)
  const result = await collectSessionSwitchResult(page)
  const trace = await diagnostics.stop()
  if (trace) console.log(`TRACE ${trace}`)
  await context.close()
  return result
}

function summarize(results: Record<"cold" | "hot", Result[]>) {
  const stats = (values: number[]) => {
    const sorted = values.slice().sort((a, b) => a - b)
    return { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1) }
  }
  return Object.fromEntries(
    Object.entries(results).map(([mode, values]) => [
      mode,
      {
        firstDestinationMs: stats(values.map((value) => value.firstDestinationMs)),
        firstCorrectMs: stats(values.map((value) => value.firstCorrectMs)),
        stableMs: stats(values.map((value) => value.stableMs)),
      },
    ]),
  )
}

async function switchSession(page: Page, sessionID: string, title: string) {
  const href = stressSessionHref(sessionID)
  const tab = page.locator(`[data-slot="titlebar-tabs"] a[href="${href}"]`).first()
  await expect(tab).toBeVisible()
  await tab.click()
  await expectSessionTitle(page, title)
}
