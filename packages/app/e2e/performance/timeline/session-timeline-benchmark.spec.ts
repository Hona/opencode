import { benchmark, benchmarkDiagnostics, expect } from "../benchmark"
import {
  buildInitialStreamEvent,
  buildStreamDeltaEvents,
  setupTimelineBenchmark,
  textPartID,
} from "./session-timeline-benchmark.fixture"
import { resetTimelineProfile, startTimelineProfile, stopTimelineProfile } from "./session-timeline-profile"
import { collectTimelineStreamMetrics, installTimelineStreamProbe } from "./session-timeline-stream-probe"

benchmark.describe("performance: session timeline streaming", () => {
  benchmark("streams assistant text without remounting or oscillating", async ({ page, report }) => {
    benchmark.setTimeout(240_000)
    const cpuThrottle = Number(process.env.TIMELINE_CPU_THROTTLE ?? 30)
    const deltaCount = Number(process.env.TIMELINE_DELTA_COUNT ?? 160)
    const historyTurns = Number(process.env.TIMELINE_HISTORY_TURNS ?? 320)
    const profileCPU = process.env.TIMELINE_CPU_PROFILE === "1"
    const profileVisual = profileCPU && process.env.TIMELINE_VISUAL_PROFILE !== "0"
    const minimal = process.env.TIMELINE_MINIMAL === "1"
    const fixture = await setupTimelineBenchmark(page, {
      historyTurns,
      eventBatch: Number(process.env.TIMELINE_EVENT_BATCH ?? 1),
    })

    await page.goto(fixture.navigationURL)
    await fixture.expectReady()
    fixture.transport.enqueue(buildInitialStreamEvent(deltaCount))
    const contentStart = performance.now()
    await expect(fixture.text).toBeVisible()
    await expect(fixture.text).toContainText("Implementation plan")
    const initialContentReadyMs = performance.now() - contentStart
    await fixture.scrollToBottom()
    await fixture.waitForStableGeometry()

    const profile = await startTimelineProfile(page, { cpuThrottle, profileCPU })
    await installTimelineStreamProbe(page, { textPartID, profileVisual, minimal })
    const deltas = buildStreamDeltaEvents(deltaCount)
    fixture.transport.enqueue(deltas)

    await page.waitForTimeout(20_000)
    const metrics = await collectTimelineStreamMetrics(page, {
      textPartID,
      navigations: benchmarkDiagnostics(page).navigations,
    })
    const delivered = deltas.length - fixture.transport.pendingCount()
    await stopTimelineProfile(profile)

    report(
      {
        initialContentReadyMs,
        ...metrics,
        deliveredDeltas: delivered,
        pendingDeltas: fixture.transport.pendingCount(),
      },
      {
        cpuThrottle,
        profileCPU,
        profileVisual,
        minimal,
        queuedDeltas: deltas.length,
        historyTurns,
      },
    )

    await resetTimelineProfile(profile)
    fixture.transport.releaseAll()
    await expect(fixture.text).toContainText("benchmark-complete", { timeout: 60_000 })
    await expect(fixture.text).toContainText("Streaming")
    await fixture.waitForStableGeometry()
  })
})
