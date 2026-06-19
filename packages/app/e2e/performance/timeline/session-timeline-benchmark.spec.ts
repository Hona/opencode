import { benchmark, benchmarkDiagnostics, expect } from "../benchmark"
import {
  buildInitialStreamEvent,
  buildStreamDeltaEvents,
  setupTimelineBenchmark,
  textPartID,
} from "./session-timeline-benchmark.fixture"
import { startTimelineProfile } from "./session-timeline-profile"
import {
  collectTimelineStreamMetrics,
  installTimelineStreamProbe,
  startTimelineStreamProbe,
} from "./session-timeline-stream-probe"

benchmark.describe("performance: session timeline streaming", () => {
  benchmark("streams assistant text without remounting or oscillating", async ({ page, report }) => {
    benchmark.setTimeout(480_000)
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

    fixture.transport.enqueue(buildInitialStreamEvent(deltaCount))
    const contentStart = performance.now()
    await expect(fixture.text).toBeVisible()
    await expect(fixture.text).toContainText("Implementation plan")
    const initialContentObservedMs = performance.now() - contentStart
    await fixture.scrollToBottom()
    await fixture.waitForStableGeometry()

    const profile = await startTimelineProfile(page, { cpuThrottle, profileCPU })
    await installTimelineStreamProbe(page, { textPartID, finalIndex: deltaCount, profileVisual, minimal })
    const deltas = buildStreamDeltaEvents(deltaCount)
    await startTimelineStreamProbe(page)
    fixture.transport.enqueue(deltas)

    await page.waitForFunction(
      (finalIndex) =>
        (
          window as Window & {
            __timelineStreamBenchmark?: { applied: { index: number }[] }
          }
        ).__timelineStreamBenchmark?.applied.some((value) => value.index === finalIndex),
      deltaCount,
      { timeout: 420_000 },
    )
    await expect(fixture.text).toContainText("benchmark-complete")
    const metrics = await collectTimelineStreamMetrics(page, {
      textPartID,
      finalIndex: deltaCount,
      navigations: benchmarkDiagnostics(page).navigations,
    })
    const delivered = deltas.length - fixture.transport.pendingCount()
    await profile.stop()

    report(
      {
        endToEndInitialContentObservedMs: initialContentObservedMs,
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

    await profile.reset()
    await expect(fixture.text).toContainText("Streaming")
    await fixture.waitForStableGeometry()
  })
})
