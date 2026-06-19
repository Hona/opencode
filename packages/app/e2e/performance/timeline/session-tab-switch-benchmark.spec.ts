import { expect, test, type Browser, type Page } from "@playwright/test"
import { expectSessionTitle } from "../../utils/waits"
import { startChromeTrace } from "../chrome-trace"
import { fixture } from "./session-timeline-stress.fixture"
import { installStressSessionTabs, mockStressTimeline, stressSessionHref } from "./timeline-test-helpers"
import { classifySessionSwitch, isStableDestination } from "./session-tab-switch-metrics"

type Result = ReturnType<typeof classifySessionSwitch>

test("benchmarks cold and hot session tab switching", async ({ browser }) => {
  test.setTimeout(180_000)
  const results = { cold: [] as Result[], hot: [] as Result[] }
  for (const mode of ["cold", "hot"] as const) {
    for (let run = 0; run < 5; run++) results[mode].push(await trial(browser, mode, run))
  }
  console.log("session tab switch benchmark", JSON.stringify({ results, summary: summarize(results) }))
  results.hot.forEach((result) => {
    expect(result.wrongDestinationFrames).toBe(0)
    expect(result.blankFrames).toBe(0)
    expect(result.sourceFrames).toBe(0)
  })
})

async function trial(browser: Browser, mode: "cold" | "hot", run: number) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const profile = process.env.SESSION_TAB_CPU_PROFILE === "1" && mode === "cold" && run === 0
  const stopTrace = profile ? await startChromeTrace(page, "session-tab-switch-cold") : undefined
  await mockStressTimeline(page)
  await installStressSessionTabs(page)
  if (mode === "hot") {
    await page.goto(stressSessionHref(fixture.targetID))
    await expectSessionTitle(page, fixture.expected.targetTitle)
    await waitForDestinationReady(page, fixture.expected.targetMessageIDs.at(-1)!)
    await switchSession(page, fixture.sourceID, fixture.expected.sourceTitle)
  } else {
    await page.goto(stressSessionHref(fixture.sourceID))
    await expectSessionTitle(page, fixture.expected.sourceTitle)
  }

  const destinationIDs = fixture.messages[fixture.targetID].map((message) => message.info.id)
  const sourceIDs = fixture.messages[fixture.sourceID].map((message) => message.info.id)
  const lastID = fixture.expected.targetMessageIDs.at(-1)!
  const href = stressSessionHref(fixture.targetID)
  await page.evaluate(
    ({ destinationIDs, sourceIDs, lastID, href }) => {
      const destination = new Set(destinationIDs)
      const source = new Set(sourceIDs)
      const samples: Array<{
        at: number
        destination: string[]
        source: string[]
        last: boolean
        bottomError?: number
      }> = []
      let started: number | undefined
      let running = true
      const sample = () => {
        if (!running || started === undefined) return
        setTimeout(() => {
          if (!running || started === undefined) return
          const root = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((element) =>
            element.querySelector("[data-timeline-row]"),
          )
          if (root) {
            const view = root.getBoundingClientRect()
            const visible = [...root.querySelectorAll<HTMLElement>("[data-message-id]")]
              .filter((element) => {
                const rect = element.getBoundingClientRect()
                return rect.bottom > view.top && rect.top < view.bottom
              })
              .map((element) => element.dataset.messageId!)
            const spacer = root
              .querySelector<HTMLElement>('[data-timeline-row="bottom-spacer"]')
              ?.getBoundingClientRect()
            samples.push({
              at: performance.now() - started,
              destination: visible.filter((id) => destination.has(id)),
              source: visible.filter((id) => source.has(id)),
              last: visible.includes(lastID),
              bottomError: spacer ? spacer.bottom - view.bottom : undefined,
            })
          }
          requestAnimationFrame(sample)
        }, 0)
      }
      document.addEventListener(
        "click",
        (event) => {
          const link = event.target instanceof Element ? event.target.closest("a") : undefined
          if (link?.getAttribute("href") !== href) return
          started = performance.now()
          requestAnimationFrame(sample)
        },
        { capture: true, once: true },
      )
      ;(
        window as Window & { __sessionSwitchProbe?: { samples: typeof samples; stop: () => void } }
      ).__sessionSwitchProbe = {
        samples,
        stop: () => {
          running = false
        },
      }
    },
    { destinationIDs, sourceIDs, lastID, href },
  )

  await switchSession(page, fixture.targetID, fixture.expected.targetTitle)
  await page.waitForFunction(() => {
    const samples = (
      window as Window & { __sessionSwitchProbe?: { samples: Array<{ last: boolean; bottomError?: number }> } }
    ).__sessionSwitchProbe?.samples
    if (!samples) return false
    return samples.some((_, index) => {
      const stable = samples.slice(index, index + 3)
      return (
        stable.length === 3 && stable.every((sample) => sample.last && Math.abs(sample.bottomError ?? Infinity) <= 1)
      )
    })
  })
  const samples = await page.evaluate(() => {
    const probe = (
      window as Window & {
        __sessionSwitchProbe?: {
          samples: Array<{ at: number; destination: string[]; source: string[]; last: boolean; bottomError?: number }>
          stop: () => void
        }
      }
    ).__sessionSwitchProbe!
    probe.stop()
    return probe.samples
  })
  const result = classifySessionSwitch(samples)
  const trace = await stopTrace?.()
  if (trace) console.log(`TRACE ${trace}`)
  await context.close()
  return result
}

async function waitForDestinationReady(page: Page, lastID: string) {
  const samples: { last: boolean; bottomError?: number }[] = []
  await expect
    .poll(
      async () => {
        samples.push(
          await page.evaluate(
            (lastID) =>
              new Promise<{ last: boolean; bottomError?: number }>((resolve) => {
                requestAnimationFrame(() =>
                  setTimeout(() => {
                    const root = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((element) =>
                      element.querySelector("[data-timeline-row]"),
                    )
                    if (!root) {
                      resolve({ last: false })
                      return
                    }
                    const view = root.getBoundingClientRect()
                    const last = [...root.querySelectorAll<HTMLElement>("[data-message-id]")].some((element) => {
                      if (element.dataset.messageId !== lastID) return false
                      const rect = element.getBoundingClientRect()
                      return rect.bottom > view.top && rect.top < view.bottom
                    })
                    const spacer = root
                      .querySelector<HTMLElement>('[data-timeline-row="bottom-spacer"]')
                      ?.getBoundingClientRect()
                    resolve({ last, bottomError: spacer ? spacer.bottom - view.bottom : undefined })
                  }, 0),
                )
              }),
            lastID,
          ),
        )
        return isStableDestination(samples.slice(-3))
      },
      { timeout: 30_000, intervals: [0] },
    )
    .toBe(true)
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
