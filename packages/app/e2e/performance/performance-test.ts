import { expect, test as base, type Page } from "@playwright/test"
import { startChromeTrace } from "./chrome-trace"

export type PerformancePageDiagnostics = {
  navigations: string[]
  stop: () => Promise<string | undefined>
}

const pages = new WeakMap<Page, PerformancePageDiagnostics>()

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const diagnostics = await observePerformancePage(page, testInfo.titlePath.join("-"))
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

export { expect }

export async function observePerformancePage(page: Page, name: string, trace = true) {
  const navigations: string[] = []
  const onNavigation = (frame: ReturnType<Page["mainFrame"]>) => {
    if (frame === page.mainFrame()) navigations.push(frame.url())
  }
  page.on("framenavigated", onNavigation)
  const stopTrace = trace ? await startChromeTrace(page, name) : undefined
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

export function performanceDiagnostics(page: Page) {
  const diagnostics = pages.get(page)
  if (!diagnostics) throw new Error("Performance diagnostics are not installed for this page")
  return diagnostics
}
