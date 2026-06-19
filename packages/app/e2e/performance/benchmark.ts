import { expect, test as base, type Browser, type Page, type TestInfo } from "@playwright/test"
import { startChromeTrace } from "./chrome-trace"

type BenchmarkFixtures = {
  report: (metrics: Record<string, unknown>, context?: Record<string, unknown>) => void
}

export type PerformancePageDiagnostics = {
  navigations: string[]
  stop: () => Promise<string | undefined>
}

const pages = new WeakMap<Page, PerformancePageDiagnostics>()

export const benchmark = base.extend<BenchmarkFixtures>({
  report: async ({}, use, testInfo) => {
    let reported = false
    await use((metrics, context = {}) => {
      reported = true
      console.log(
        `BENCHMARK ${JSON.stringify({
          name: benchmarkName(testInfo),
          context: {
            project: testInfo.project.name,
            platform: process.platform,
            ...context,
          },
          metrics,
        })}`,
      )
    })
    if (!reported) throw new Error(`Benchmark did not report metrics: ${benchmarkName(testInfo)}`)
  },
  page: async ({ page }, use, testInfo) => {
    const diagnostics = await observePerformancePage(page, benchmarkName(testInfo))
    try {
      await use(page)
    } finally {
      const trace = await diagnostics.stop()
      if (trace) console.log(`TRACE ${trace}`)
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("performance-navigations", {
          body: JSON.stringify(diagnostics.navigations, null, 2),
          contentType: "application/json",
        })
      }
    }
  },
})

function benchmarkName(testInfo: TestInfo) {
  return testInfo.titlePath.slice(1).join(" > ")
}

export { expect }

async function observePerformancePage(page: Page, name: string) {
  const navigations: string[] = []
  const onNavigation = (frame: ReturnType<Page["mainFrame"]>) => {
    if (frame === page.mainFrame()) navigations.push(frame.url())
  }
  page.on("framenavigated", onNavigation)
  const stopTrace = await startChromeTrace(page, name)
  let stopped = false
  const diagnostics = {
    navigations,
    async stop() {
      if (stopped) return
      stopped = true
      page.off("framenavigated", onNavigation)
      return stopTrace?.()
    },
  }
  pages.set(page, diagnostics)
  return diagnostics
}

export async function withBenchmarkPage<T>(browser: Browser, name: string, run: (page: Page) => Promise<T>) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const diagnostics = await observePerformancePage(page, name)
  try {
    return await run(page)
  } finally {
    const trace = await diagnostics.stop()
    if (trace) console.log(`TRACE ${trace}`)
    await context.close()
  }
}

export function benchmarkDiagnostics(page: Page) {
  const diagnostics = pages.get(page)
  if (!diagnostics) throw new Error("Performance diagnostics are not installed for this page")
  return diagnostics
}
