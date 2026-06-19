import { expect, performanceDiagnostics, test } from "../performance-test"
import {
  buildInitialStreamEvent,
  buildStreamDeltaEvents,
  setupTimelineBenchmark,
  textPartID,
} from "./session-timeline-benchmark.fixture"
import { resetTimelineProfile, startTimelineProfile, stopTimelineProfile } from "./session-timeline-profile"
import { collectTimelineStreamMetrics, installTimelineStreamProbe } from "./session-timeline-stream-probe"

test.describe("performance: session timeline streaming", () => {
  test("streams assistant text without remounting or oscillating", async ({ page }) => {
    test.setTimeout(240_000)
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
      navigations: performanceDiagnostics(page).navigations,
    })
    const delivered = deltas.length - fixture.transport.pendingCount()
    await stopTimelineProfile(profile)

    console.log(
      "timeline stream benchmark",
      JSON.stringify({
        cpuThrottle,
        profileCPU,
        profileVisual,
        minimal,
        initialContentReadyMs,
        ...metrics,
        queuedDeltas: deltas.length,
        historyTurns,
        deliveredDeltas: delivered,
        pendingDeltas: fixture.transport.pendingCount(),
      }),
    )
    expect(metrics.blanks).toBe(0)
    expect(metrics.rowReplaced).toBe(false)
    expect(metrics.markdownReplaced).toBe(false)
    expect(metrics.visibleMounts).toBe(0)
    expect(metrics.visibleUnmounts).toBe(0)
    expect(metrics.paintedSubtreeDropouts).toEqual([])
    expect(metrics.maxOverlap).toBeLessThanOrEqual(1)
    expect(metrics.maxGap).toBeLessThanOrEqual(1)
    if (!profileCPU) {
      expect(metrics.fps).toBeGreaterThanOrEqual(25)
      expect(metrics.p95).toBeLessThanOrEqual(100)
      expect(metrics.framesUnder20Fps).toBeLessThanOrEqual(150)
      expect(metrics.droppedFrameEquivalents).toBeLessThanOrEqual(750)
      expect(metrics.longestSlowStreak).toBeLessThanOrEqual(20)
      expect(metrics.longTaskTime).toBeLessThanOrEqual(1_000)
    }
    expect(metrics.maxDistance).toBeLessThanOrEqual(80)
    expect(metrics.finalDistance).toBeLessThanOrEqual(1)
    expect(metrics.corrections).toBeLessThanOrEqual(3)
    expect(delivered).toBeGreaterThanOrEqual(40)

    await resetTimelineProfile(profile)
    fixture.transport.releaseAll()
    await expect(fixture.text).toContainText("benchmark-complete", { timeout: 60_000 })
    await expect(fixture.text).toContainText("Streaming")
    await fixture.waitForStableGeometry()
  })
})
