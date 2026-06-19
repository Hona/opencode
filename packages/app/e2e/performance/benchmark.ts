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
    const name = benchmarkName(testInfo)
    const diagnostics = await observePerformancePage(page, name)
    try {
      await use(page)
    } finally {
      try {
        await reportPerformancePage(name, diagnostics)
      } finally {
        if (testInfo.status !== testInfo.expectedStatus) {
          await testInfo.attach("performance-navigations", {
            body: JSON.stringify(diagnostics.navigations, null, 2),
            contentType: "application/json",
          })
        }
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
  const stopTrace = await startChromeTrace(page, name).catch((error) => {
    page.off("framenavigated", onNavigation)
    throw error
  })
  let stopping: Promise<string | undefined> | undefined
  const diagnostics: PerformancePageDiagnostics = {
    navigations,
    stop() {
      page.off("framenavigated", onNavigation)
      return (stopping ??= stopTrace?.() ?? Promise.resolve(undefined))
    },
  }
  pages.set(page, diagnostics)
  return diagnostics
}

export async function withBenchmarkPage<T>(browser: Browser, name: string, run: (page: Page) => Promise<T>) {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    const diagnostics = await observePerformancePage(page, name)
    try {
      return await run(page)
    } finally {
      await reportPerformancePage(name, diagnostics)
    }
  } finally {
    await context.close()
  }
}

async function reportPerformancePage(name: string, diagnostics: PerformancePageDiagnostics) {
  const trace = await diagnostics.stop()
  console.log(
    `BENCHMARK_PAGE ${JSON.stringify({
      name,
      context: {
        platform: process.platform,
        trace,
        selectorTrace: process.env.OPENCODE_PERFORMANCE_SELECTOR_TRACE === "1",
      },
      navigations: diagnostics.navigations,
    })}`,
  )
}

export function benchmarkDiagnostics(page: Page) {
  const diagnostics = pages.get(page)
  if (!diagnostics) throw new Error("Performance diagnostics are not installed for this page")
  return diagnostics
}
