import type { Page } from "@playwright/test"
import path from "node:path"
import { mkdir, writeFile } from "node:fs/promises"

export async function startChromeTrace(page: Page, name: string) {
  const directory = process.env.OPENCODE_PERFORMANCE_TRACE_DIR
  if (!directory) return

  const session = await page.context().newCDPSession(page)
  const events: unknown[] = []
  session.on("Tracing.dataCollected", (event) => events.push(...event.value))
  await session.send("Tracing.start", {
    transferMode: "ReportEvents",
    traceConfig: {
      recordMode: "recordUntilFull",
      includedCategories: [
        "blink.user_timing",
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-devtools.timeline.frame",
        "disabled-by-default-devtools.timeline.inputs",
        "disabled-by-default-v8.cpu_profiler",
        "disabled-by-default-v8.cpu_profiler.hires",
        "loading",
        "toplevel",
        "v8",
        "v8.execute",
        ...(process.env.OPENCODE_PERFORMANCE_SELECTOR_TRACE === "1"
          ? ["disabled-by-default-blink.debug", "disabled-by-default-devtools.timeline.invalidationTracking"]
          : []),
      ],
    },
  })

  return async () => {
    const complete = new Promise<void>((resolve) => session.once("Tracing.tracingComplete", () => resolve()))
    await session.send("Tracing.end")
    await complete
    const file = await writeChromeTrace(
      directory,
      name,
      events,
      process.env.OPENCODE_PERFORMANCE_SELECTOR_TRACE === "1",
    )
    await session.detach()
    return file
  }
}

export async function writeChromeTrace(directory: string, name: string, events: unknown[], selectors: boolean) {
  await mkdir(directory, { recursive: true })
  const suffix = selectors ? "-selectors" : ""
  const file = path.join(directory, `${name.replace(/[^a-zA-Z0-9_-]/g, "-")}${suffix}.json`)
  await writeFile(file, JSON.stringify({ traceEvents: events }))
  return file
}
