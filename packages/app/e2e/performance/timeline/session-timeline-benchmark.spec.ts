import { expect, test, type Locator, type Page } from "@playwright/test"
import { writeFile } from "node:fs/promises"
import { mockOpenCodeServer } from "../../utils/mock-server"
import { expectAppVisible, expectSessionTitle } from "../../utils/waits"

const directory = "C:/OpenCode/TimelineStateRegression"
const projectID = "proj_timeline_state_regression"
const sessionID = "ses_timeline_state_regression"
const userMessageID = "msg_user_regression"
const assistantMessageID = "msg_assistant_regression"
const editPartID = "prt_0001_edit"
const textPartID = "prt_9999_text"
const title = "Timeline collapse state regression"
const model = { providerID: "opencode", modelID: "claude-opus-4-6", variant: "max" }

type EventPayload = {
  directory: string
  payload: Record<string, unknown>
}

const userMessage = {
  info: {
    id: userMessageID,
    sessionID,
    role: "user",
    time: { created: 1700000000000 },
    summary: { diffs: [] },
    agent: "build",
    model,
  },
  parts: [
    {
      id: "prt_user_text",
      sessionID,
      messageID: userMessageID,
      type: "text",
      text: "Please edit the file.",
    },
  ],
}

const editPart = {
  id: editPartID,
  sessionID,
  messageID: assistantMessageID,
  type: "tool",
  callID: "call_edit_regression",
  tool: "edit",
  state: {
    status: "completed",
    input: { filePath: "src/regression.ts" },
    output: "Edited src/regression.ts",
    title: "src/regression.ts",
    metadata: {
      filediff: {
        file: "src/regression.ts",
        additions: 1,
        deletions: 1,
        before: "export const value = 'before'\n",
        after: "export const value = 'after'\n",
      },
      diff: "diff --git a/src/regression.ts b/src/regression.ts\n-export const value = 'before'\n+export const value = 'after'\n",
    },
    time: { start: 1700000001000, end: 1700000002000 },
  },
}

const streamedTextPart = {
  id: textPartID,
  sessionID,
  messageID: assistantMessageID,
  type: "text",
  text: "Streaming added a later assistant text part.",
}

const assistantMessage = {
  info: {
    id: assistantMessageID,
    sessionID,
    role: "assistant",
    time: { created: 1700000001000 },
    parentID: userMessageID,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "build",
    agent: "build",
    path: { cwd: directory, root: directory },
    cost: 0.01,
    tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
    variant: "max",
  },
  parts: [editPart],
}

const longSessionMessages = () => [
  ...Array.from({ length: Number(process.env.TIMELINE_HISTORY_TURNS ?? 320) }, (_, index) =>
    performanceTurn(index),
  ).flat(),
  userMessage,
  assistantMessage,
]

test.describe("regression: session timeline local row state", () => {
  test("streams assistant text without remounting or oscillating", async ({ page }) => {
    test.setTimeout(240_000)
    const cpuThrottle = Number(process.env.TIMELINE_CPU_THROTTLE ?? 30)
    const deltaCount = Number(process.env.TIMELINE_DELTA_COUNT ?? 160)
    const profileCPU = process.env.TIMELINE_CPU_PROFILE === "1"
    const profileVisual = profileCPU && process.env.TIMELINE_VISUAL_PROFILE !== "0"
    const minimal = process.env.TIMELINE_MINIMAL === "1"
    await page.setViewportSize({ width: 1366, height: 768 })
    const cdp = await page.context().newCDPSession(page)
    const events: EventPayload[] = []
    let eventBatch = Number(process.env.TIMELINE_EVENT_BATCH ?? 1)
    await mockServer(page, events, longSessionMessages(), () => eventBatch)
    await configurePage(page)

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)
    const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
    await expectAppVisible(scroller)

    events.push({
      directory,
      payload: {
        type: "message.part.updated",
        properties: {
          part: {
            ...streamedTextPart,
            text: `Streaming${streamChunk(0, deltaCount + 1)}\n\n\`\`\`ts\nconst initial = true\n\`\`\``,
          },
        },
      },
    })
    const contentStart = performance.now()
    const text = page.locator(`[data-timeline-part-id="${textPartID}"]`).first()
    await expect(text).toBeVisible()
    await expect(text).toContainText("Implementation plan")
    await expect(text.locator('[data-component="markdown-code"]').first()).toBeVisible()
    const initialContentReadyMs = performance.now() - contentStart
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await waitForStableGeometry(page, scroller)
    if (cpuThrottle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle })
    const traceEvents: unknown[] = []
    if (process.env.TIMELINE_CHROME_TRACE) {
      cdp.on("Tracing.dataCollected", (event) => traceEvents.push(...event.value))
      await cdp.send("Tracing.start", {
        transferMode: "ReportEvents",
        categories: [
          "-*",
          "blink.user_timing",
          "devtools.timeline",
          "disabled-by-default-devtools.timeline",
          "disabled-by-default-devtools.timeline.frame",
          "loading",
          "toplevel",
          "v8",
        ].join(","),
      })
    }
    if (profileCPU) {
      await cdp.send("Profiler.enable")
      await cdp.send("Profiler.setSamplingInterval", { interval: 100 })
      await cdp.send("Profiler.start")
    }

    await page.evaluate(
      ({ textPartID, profileCPU, profileVisual, minimal }) => {
        const part = document.querySelector<HTMLElement>(`[data-timeline-part-id="${textPartID}"]`)
        const row = part?.closest<HTMLElement>("[data-timeline-row]")
        const markdown = part?.querySelector<HTMLElement>('[data-component="markdown"]')
        const root = part?.closest<HTMLElement>(".scroll-view__viewport")
        if (!part || !row || !markdown || !root) throw new Error("missing streaming benchmark nodes")
        const state = {
          frames: [] as number[],
          frameAt: [] as number[],
          applied: [] as { at: number; index: number }[],
          geometry: [] as {
            scrollTop: number
            scrollHeight: number
            clientHeight: number
            distance: number
            virtualHeight: number
            headerHeight: number
          }[],
          blanks: 0,
          longTasks: [] as number[],
          layoutShifts: [] as number[],
          visibleMounts: 0,
          visibleUnmounts: 0,
          visibleSubtreeMounts: [] as string[],
          visibleSubtreeUnmounts: [] as string[],
          visibleSubtreeReplacements: 0,
          paintedSubtreeDropouts: [] as string[],
          paintedSubtrees: new Map<string, Element>(),
          maxOverlap: 0,
          maxGap: 0,
          maxPartTopMovement: 0,
          previousPartTop: part.getBoundingClientRect().top,
          slowFrames: [] as {
            duration: number
            index: number
            phase: "code" | "boundary" | "complete" | "unknown"
            tokenSpans: number
            blocks: number
            codeBlocks: number
            height: number
            distance: number
          }[],
          scroll: {
            calls: 0,
            callNoops: 0,
            sameFrameCalls: 0,
            assignments: 0,
            assignmentNoops: 0,
            lastCallFrame: -1,
            frame: 0,
          },
          row,
          markdown,
          running: true,
          previous: performance.now(),
        }
        ;(window as Window & { __timelineStreamBenchmark?: typeof state }).__timelineStreamBenchmark = state
        if (profileVisual) {
          const scrollTo = Element.prototype.scrollTo
          Element.prototype.scrollTo = function (...args) {
            state.scroll.calls += 1
            const top = typeof args[0] === "object" ? args[0]?.top : args[1]
            if (typeof top === "number") {
              const target = Math.min(top, this.scrollHeight - this.clientHeight)
              if (Math.abs(this.scrollTop - target) < 1) state.scroll.callNoops += 1
            }
            if (state.scroll.lastCallFrame === state.scroll.frame) state.scroll.sameFrameCalls += 1
            state.scroll.lastCallFrame = state.scroll.frame
            return scrollTo.apply(this, args)
          }
          const scrollTop = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!
          Object.defineProperty(Element.prototype, "scrollTop", {
            configurable: true,
            get: scrollTop.get,
            set(value) {
              state.scroll.assignments += 1
              if (Math.abs(this.scrollTop - value) < 1) state.scroll.assignmentNoops += 1
              scrollTop.set!.call(this, value)
            },
          })
        }

        new PerformanceObserver((list) => {
          if (!state.running) return
          state.longTasks.push(...list.getEntries().map((entry) => entry.duration))
        }).observe({ type: "longtask" })
        if (profileVisual)
          new PerformanceObserver((list) => {
            if (!state.running) return
            state.layoutShifts.push(
              ...list
                .getEntries()
                .filter((entry) => !(entry as PerformanceEntry & { hadRecentInput?: boolean }).hadRecentInput)
                .map((entry) => (entry as PerformanceEntry & { value: number }).value),
            )
          }).observe({ type: "layout-shift", buffered: true })

        const visible = (element: Element) => {
          const rect = element.getBoundingClientRect()
          const viewport = root.getBoundingClientRect()
          return rect.bottom > viewport.top && rect.top < viewport.bottom
        }
        const critical = [
          "[data-timeline-part-id]",
          '[data-component="edit-content"]',
          '[data-component="apply-patch-file-diff"]',
          '[data-component="file"]',
          '[data-component="markdown-code"]',
          "[data-markdown-block]",
        ].join(",")
        const describe = (element: Element) => {
          const part = element.closest<HTMLElement>("[data-timeline-part-id]")?.dataset.timelinePartId ?? "unknown"
          const block = element
            .closest<HTMLElement>("[data-markdown-key]")
            ?.dataset.markdownKey?.replace(/:(?:code|full|live)$/, "")
          const component =
            element.getAttribute("data-component") ?? element.getAttribute("data-markdown-block") ?? element.tagName
          return `${part}:${block ?? "root"}:${component}`
        }
        if (profileVisual)
          new MutationObserver((records) => {
            if (!state.running) return
            records.forEach((record) => {
              record.addedNodes.forEach((node) => {
                if (node instanceof HTMLElement && node.matches("[data-timeline-key]") && visible(node))
                  state.visibleMounts += 1
                if (!(node instanceof Element)) return
                const added = [node, ...node.querySelectorAll(critical)].filter((element) => element.matches(critical))
                added.forEach((element) => {
                  if (visible(element)) state.visibleSubtreeMounts.push(describe(element))
                })
              })
              record.removedNodes.forEach((node) => {
                if (node instanceof HTMLElement && node.matches("[data-timeline-key]") && visible(node))
                  state.visibleUnmounts += 1
                if (!(node instanceof Element)) return
                const removed = [node, ...node.querySelectorAll(critical)].filter((element) =>
                  element.matches(critical),
                )
                removed.forEach((element) => state.visibleSubtreeUnmounts.push(describe(element)))
              })
              if (record.addedNodes.length > 0 && record.removedNodes.length > 0) state.visibleSubtreeReplacements += 1
            })
          }).observe(root, { childList: true, subtree: true })

        const sample = (now: number) => {
          if (!state.running) return
          state.frameAt.push(now)
          const applied = Number(
            part.textContent
              ?.match(/stream-(\d+)/g)
              ?.at(-1)
              ?.match(/\d+/)?.[0] ?? -1,
          )
          if (applied >= 0 && applied !== state.applied.at(-1)?.index) state.applied.push({ at: now, index: applied })
          if (minimal) {
            state.frames.push(now - state.previous)
            state.previous = now
            requestAnimationFrame(sample)
            return
          }
          setTimeout(() => {
            if (!state.running) return
            state.scroll.frame += 1
            const duration = now - state.previous
            state.frames.push(duration)
            state.previous = now
            const virtualRoot = root.querySelector<HTMLElement>("[data-timeline-virtual-content]")
            const header = root.querySelector<HTMLElement>("[data-session-title]")
            state.geometry.push({
              scrollTop: root.scrollTop,
              scrollHeight: root.scrollHeight,
              clientHeight: root.clientHeight,
              distance: root.scrollHeight - root.clientHeight - root.scrollTop,
              virtualHeight: virtualRoot?.getBoundingClientRect().height ?? 0,
              headerHeight: header?.getBoundingClientRect().height ?? 0,
            })
            const viewport = root.getBoundingClientRect()
            if (profileVisual) {
              const rows = [...root.querySelectorAll<HTMLElement>("[data-timeline-key]")]
                .map((element) => element.getBoundingClientRect())
                .filter((rect) => rect.bottom > viewport.top && rect.top < viewport.bottom)
                .sort((a, b) => a.top - b.top)
              rows.slice(1).forEach((rect, index) => {
                const previous = rows[index]!
                state.maxOverlap = Math.max(state.maxOverlap, previous.bottom - rect.top)
                state.maxGap = Math.max(state.maxGap, rect.top - previous.bottom)
              })
              const partTop = part.getBoundingClientRect().top
              state.maxPartTopMovement = Math.max(state.maxPartTopMovement, Math.abs(partTop - state.previousPartTop))
              state.previousPartTop = partTop
            }
            const visibleRow = [...root.querySelectorAll<HTMLElement>("[data-timeline-row]")].some((element) => {
              const rect = element.getBoundingClientRect()
              return rect.bottom > viewport.top && rect.top < viewport.bottom
            })
            if (!visibleRow) state.blanks += 1
            if (profileVisual) {
              const paintedSubtrees = new Map<string, Element>()
              root.querySelectorAll(critical).forEach((element) => {
                const key = describe(element)
                const rect = element.getBoundingClientRect()
                const style = getComputedStyle(element)
                const painted =
                  element.isConnected &&
                  rect.width > 0 &&
                  rect.height > 0 &&
                  style.display !== "none" &&
                  style.visibility !== "hidden" &&
                  Number(style.opacity) > 0
                if (painted) {
                  const previous = state.paintedSubtrees.get(key)
                  if (previous && previous !== element && key.startsWith(`${textPartID}:`))
                    state.visibleSubtreeReplacements += 1
                  paintedSubtrees.set(key, element)
                }
              })
              state.paintedSubtrees.forEach((element, key) => {
                if (key.startsWith(`${textPartID}:`) && !paintedSubtrees.has(key)) {
                  const markdown = part.querySelector<HTMLElement>('[data-component="markdown"]')
                  state.paintedSubtreeDropouts.push(
                    `${key}:projection=${markdown?.dataset.markdownProjectionLength}/${markdown?.dataset.markdownProjectionBlocks}:result=${markdown?.dataset.markdownResultLength}/${markdown?.dataset.markdownResultBlocks}:applied=${markdown?.dataset.markdownAppliedBlocks}:dom=${markdown?.children.length}`,
                  )
                }
                if (element.matches('[data-component="file"]')) {
                  const hadLines = element.hasAttribute("data-profiler-had-lines")
                  const hasLines = element.shadowRoot?.querySelector("[data-line]") != null
                  if (hasLines) element.setAttribute("data-profiler-had-lines", "")
                  if (hadLines && !hasLines) state.paintedSubtreeDropouts.push(`${key}:shadow-lines`)
                }
              })
              state.paintedSubtrees = paintedSubtrees
            }
            if (profileVisual && duration > 33.34) {
              const content = part.textContent ?? ""
              const index = Number(
                content
                  .match(/streamedValue(\d+)/g)
                  ?.at(-1)
                  ?.match(/\d+/)?.[0] ?? -1,
              )
              state.slowFrames.push({
                duration,
                index,
                phase: content.includes("benchmark-complete")
                  ? "complete"
                  : index >= 0 && index % 20 === 0
                    ? "boundary"
                    : index >= 0
                      ? "code"
                      : "unknown",
                tokenSpans: part.querySelectorAll(".shiki span").length,
                blocks: part.querySelectorAll("[data-markdown-block]").length,
                codeBlocks: part.querySelectorAll('[data-component="markdown-code"]').length,
                height: part.getBoundingClientRect().height,
                distance: root.scrollHeight - root.clientHeight - root.scrollTop,
              })
            }
            requestAnimationFrame(sample)
          }, 0)
        }
        requestAnimationFrame(sample)
      },
      { textPartID, profileCPU, profileVisual, minimal },
    )

    const deltas = Array.from({ length: deltaCount }, (_, index) => ({
      directory,
      payload: {
        type: "message.part.delta",
        properties: {
          messageID: assistantMessageID,
          partID: textPartID,
          field: "text",
          delta: streamChunk(index + 1, deltaCount + 1),
        },
      },
    }))
    events.push(...deltas)

    await page.waitForTimeout(20_000)
    if (process.env.TIMELINE_CHROME_TRACE) {
      const complete = new Promise<void>((resolve) => cdp.once("Tracing.tracingComplete", () => resolve()))
      await cdp.send("Tracing.end")
      await complete
      await writeFile(process.env.TIMELINE_CHROME_TRACE, JSON.stringify({ traceEvents }))
    }
    const metrics = await page.evaluate(
      ({ textPartID }) => {
        const state = (
          window as Window & {
            __timelineStreamBenchmark?: {
              frames: number[]
              frameAt: number[]
              applied: { at: number; index: number }[]
              geometry: {
                scrollTop: number
                scrollHeight: number
                clientHeight: number
                distance: number
                virtualHeight: number
                headerHeight: number
              }[]
              blanks: number
              longTasks: number[]
              layoutShifts: number[]
              visibleMounts: number
              visibleUnmounts: number
              visibleSubtreeMounts: string[]
              visibleSubtreeUnmounts: string[]
              visibleSubtreeReplacements: number
              paintedSubtreeDropouts: string[]
              maxOverlap: number
              maxGap: number
              maxPartTopMovement: number
              slowFrames: {
                duration: number
                index: number
                phase: "code" | "boundary" | "complete" | "unknown"
                tokenSpans: number
                blocks: number
                codeBlocks: number
                height: number
                distance: number
              }[]
              scroll: {
                calls: number
                callNoops: number
                sameFrameCalls: number
                assignments: number
                assignmentNoops: number
                lastCallFrame: number
                frame: number
              }
              row: HTMLElement
              markdown: HTMLElement
              running: boolean
            }
          }
        ).__timelineStreamBenchmark
        if (!state) throw new Error("missing streaming benchmark state")
        state.running = false
        const part = document.querySelector<HTMLElement>(`[data-timeline-part-id="${textPartID}"]`)
        const row = part?.closest<HTMLElement>("[data-timeline-row]")
        const markdown = part?.querySelector<HTMLElement>('[data-component="markdown"]')
        const sorted = state.frames.slice().sort((a, b) => a - b)
        const duration = state.frames.reduce((sum, value) => sum + value, 0)
        const longestSlowStreak = state.frames.reduce(
          (result, value) => {
            const current = value > 33.34 ? result.current + 1 : 0
            return { current, longest: Math.max(result.longest, current) }
          },
          { current: 0, longest: 0 },
        ).longest
        const corrections = state.geometry.slice(1).filter((value, index) => {
          const previous = state.geometry[index]?.distance ?? 0
          return previous <= 1 && value.distance > 1
        }).length
        const busyStart = state.applied.at(0)?.at
        const busyEnd = state.applied.at(-1)?.at
        const busyFrames =
          busyStart === undefined || busyEnd === undefined
            ? []
            : state.frames.filter((_, index) => state.frameAt[index]! >= busyStart && state.frameAt[index]! <= busyEnd)
        const busySorted = busyFrames.slice().sort((a, b) => a - b)
        const busyDuration = busyFrames.reduce((sum, value) => sum + value, 0)
        return {
          frames: state.frames.length,
          fps: duration ? (state.frames.length * 1000) / duration : 0,
          busyFps: busyDuration ? (busyFrames.length * 1000) / busyDuration : 0,
          busyP95: busySorted[Math.floor(busySorted.length * 0.95)] ?? 0,
          busyFrames: busyFrames.length,
          appliedIndex: state.applied.at(-1)?.index ?? -1,
          appliedUpdates: state.applied.length,
          p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
          p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
          p99: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
          maxFrame: sorted.at(-1) ?? 0,
          framesUnder30Fps: state.frames.filter((value) => value > 33.34).length,
          framesUnder20Fps: state.frames.filter((value) => value > 50).length,
          droppedFrameEquivalents: state.frames.reduce(
            (sum, value) => sum + Math.max(0, Math.round(value / 16.67) - 1),
            0,
          ),
          longestSlowStreak,
          longTasks: state.longTasks.length,
          longTaskTime: state.longTasks.reduce((sum, value) => sum + value, 0),
          layoutShift: state.layoutShifts.reduce((sum, value) => sum + value, 0),
          maxLayoutShift: Math.max(0, ...state.layoutShifts),
          visibleMounts: state.visibleMounts,
          visibleUnmounts: state.visibleUnmounts,
          visibleSubtreeMounts: state.visibleSubtreeMounts,
          visibleSubtreeUnmounts: [...new Set(state.visibleSubtreeUnmounts)],
          visibleSubtreeReplacements: state.visibleSubtreeReplacements,
          paintedSubtreeDropouts: [...new Set(state.paintedSubtreeDropouts)],
          maxOverlap: state.maxOverlap,
          maxGap: state.maxGap,
          maxPartTopMovement: state.maxPartTopMovement,
          maxDistance: Math.max(0, ...state.geometry.map((sample) => sample.distance)),
          finalDistance: state.geometry.at(-1)?.distance ?? 0,
          finalGeometry: state.geometry.at(-1),
          distanceTransitions: state.geometry
            .map((sample) => Math.round(sample.distance))
            .filter((value, index, values) => index === 0 || value !== values[index - 1]),
          corrections,
          blanks: state.blanks,
          rowReplaced: row !== state.row,
          markdownReplaced: markdown !== state.markdown,
          renderedCharacters: part?.textContent?.length ?? 0,
          slowestFrames: state.slowFrames.sort((a, b) => b.duration - a.duration).slice(0, 20),
          slowFramePhases: Object.fromEntries(
            ["code", "boundary", "complete", "unknown"].map((phase) => {
              const frames = state.slowFrames.filter((frame) => frame.phase === phase)
              return [
                phase,
                {
                  count: frames.length,
                  total: frames.reduce((sum, frame) => sum + frame.duration, 0),
                  max: Math.max(0, ...frames.map((frame) => frame.duration)),
                },
              ]
            }),
          ),
          scroll: state.scroll,
        }
      },
      { textPartID },
    )
    const delivered = deltas.length - events.length
    if (profileCPU) {
      const profile = await cdp.send("Profiler.stop")
      const self = new Map<number, number>()
      profile.profile.samples?.forEach((id, index) => {
        const duration = (profile.profile.timeDeltas?.[index] ?? 0) / 1_000
        self.set(id, (self.get(id) ?? 0) + duration)
      })
      console.log(
        "timeline cpu profile",
        JSON.stringify(
          profile.profile.nodes
            .map((node) => ({
              function: node.callFrame.functionName || "(anonymous)",
              url: node.callFrame.url,
              line: node.callFrame.lineNumber + 1,
              selfMs: self.get(node.id) ?? 0,
            }))
            .filter((node) => node.selfMs > 1)
            .sort((a, b) => b.selfMs - a.selfMs)
            .slice(0, 40),
        ),
      )
    }

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
        historyTurns: Number(process.env.TIMELINE_HISTORY_TURNS ?? 320),
        deliveredDeltas: delivered,
        pendingDeltas: events.length,
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

    if (cpuThrottle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 })
    eventBatch = events.length
    await expect(text).toContainText("benchmark-complete", { timeout: 60_000 })
    await expect(text).toContainText("Streaming")
    await expect(text.locator('[data-component="markdown-code"]').last()).toBeVisible()
    await waitForStableGeometry(page, scroller)
  })

})

async function configurePage(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({
        general: {
          editToolPartsExpanded: true,
          shellToolPartsExpanded: true,
          showReasoningSummaries: true,
          showSessionProgressBar: true,
        },
      }),
    )
  })
}

async function waitForStableGeometry(page: Page, scroller: Locator) {
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeLessThanOrEqual(1)
  await page.waitForFunction((partID) => {
    const root = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((element) =>
      element.querySelector(`[data-timeline-part-id="${partID}"]`),
    )
    if (!root) return false
    return new Promise<boolean>((resolve) => {
      const height = root.scrollHeight
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          resolve(root.scrollHeight === height && root.scrollHeight - root.clientHeight - root.scrollTop <= 1),
        ),
      )
    })
  }, textPartID)
}

async function mockServer(
  page: Page,
  events: EventPayload[],
  messages = [userMessage, assistantMessage],
  eventBatch = () => 1,
) {
  await mockOpenCodeServer(page, {
    directory,
    project: project(),
    provider: provider(),
    sessions: [session()],
    pageMessages: () => ({ items: messages }),
    events: () => events.splice(0, eventBatch()),
    eventRetry: 16,
  })
}

function performanceTurn(index: number) {
  const suffix = String(index).padStart(4, "0")
  const userID = `msg_0000_${suffix}_a_user`
  const assistantID = `msg_0000_${suffix}_b_assistant`
  const before = historicalSource(index, false)
  const after = historicalSource(index, true)
  const parts = [
    ...(index % 5 === 0
      ? [
          {
            id: `prt_0000_${suffix}_reasoning`,
            sessionID,
            messageID: assistantID,
            type: "reasoning",
            text: `Reviewing the existing implementation. ${"constraint analysis ".repeat(20)}`,
            time: { start: 1690000001000 + index * 2_000, end: 1690000001200 + index * 2_000 },
          },
        ]
      : []),
    {
      id: `prt_0000_${suffix}_assistant`,
      sessionID,
      messageID: assistantID,
      type: "text",
      text: historicalMarkdown(index),
    },
    ...(index % 8 === 0
      ? [
          {
            id: `prt_0000_${suffix}_edit`,
            sessionID,
            messageID: assistantID,
            type: "tool",
            callID: `call_0000_${suffix}_edit`,
            tool: "edit",
            state: {
              status: "completed",
              input: { filePath: `src/history-${index}.ts` },
              output: `Edited src/history-${index}.ts`,
              title: `src/history-${index}.ts`,
              metadata: {
                filediff: { file: `src/history-${index}.ts`, additions: 48, deletions: 48, before, after },
              },
              time: { start: 1690000001200 + index * 2_000, end: 1690000001400 + index * 2_000 },
            },
          },
        ]
      : []),
    ...(index % 12 === 0
      ? [
          {
            id: `prt_0000_${suffix}_write`,
            sessionID,
            messageID: assistantID,
            type: "tool",
            callID: `call_0000_${suffix}_write`,
            tool: "write",
            state: {
              status: "completed",
              input: { filePath: `src/generated-${index}.tsx`, content: after },
              output: `Wrote src/generated-${index}.tsx`,
              title: `src/generated-${index}.tsx`,
              metadata: {
                filediff: { file: `src/generated-${index}.tsx`, additions: 32, deletions: 0, before: "", after },
              },
              time: { start: 1690000001400 + index * 2_000, end: 1690000001500 + index * 2_000 },
            },
          },
        ]
      : []),
    ...(index % 16 === 0
      ? [
          {
            id: `prt_0000_${suffix}_patch`,
            sessionID,
            messageID: assistantID,
            type: "tool",
            callID: `call_0000_${suffix}_patch`,
            tool: "apply_patch",
            state: {
              status: "completed",
              input: { patchText: realisticPatch(index) },
              output: "Success. Updated src/components/SessionCard.tsx",
              title: "src/components/SessionCard.tsx",
              metadata: {
                files: [
                  {
                    filePath: "src/components/SessionCard.tsx",
                    relativePath: "src/components/SessionCard.tsx",
                    type: "update",
                    additions: 8,
                    deletions: 3,
                    patch: realisticPatch(index),
                    before,
                    after,
                  },
                ],
              },
              time: { start: 1690000001500 + index * 2_000, end: 1690000001700 + index * 2_000 },
            },
          },
        ]
      : []),
  ]
  return [
    {
      info: {
        id: userID,
        sessionID,
        role: "user",
        time: { created: 1690000000000 + index * 2_000 },
        summary: { diffs: [] },
        agent: "build",
        model,
      },
      parts: [
        {
          id: `prt_0000_${suffix}_user`,
          sessionID,
          messageID: userID,
          type: "text",
          text: `Historical prompt ${index}`,
        },
      ],
    },
    {
      info: {
        id: assistantID,
        sessionID,
        role: "assistant",
        time: { created: 1690000001000 + index * 2_000, completed: 1690000001500 + index * 2_000 },
        parentID: userID,
        modelID: model.modelID,
        providerID: model.providerID,
        mode: "build",
        agent: "build",
        path: { cwd: directory, root: directory },
        cost: 0.01,
        tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
        variant: "max",
        finish: "stop",
      },
      parts,
    },
  ]
}

function historicalMarkdown(index: number) {
  const code = `import { For, Show, createSignal } from "solid-js"

type SessionRow = { id: string; title: string; active: boolean }

export function SessionList(props: { rows: SessionRow[] }) {
  const [selected, setSelected] = createSignal<string>()
  return (
    <section aria-label="Sessions">
      <For each={props.rows}>{(row) => (
        <button classList={{ active: row.active }} onClick={() => setSelected(row.id)}>
          <Show when={selected() === row.id} fallback={row.title}>{row.title.toUpperCase()}</Show>
        </button>
      )}</For>
    </section>
  )
}`
  return `## Session renderer review ${index}

The active session keeps **semantic row identity** while reconciling measured content. See [Solid documentation](https://docs.solidjs.com/) and the inline \`measureElement(node)\` call.

| Concern | Current behavior | Verification |
| --- | --- | --- |
| streaming | appends Markdown blocks | painted frames |
| geometry | anchors visible rows | DOM coordinates |
| tools | preserves expanded state | keyed remount probe |

> Long sessions combine Markdown, syntax highlighting, tool output, and asynchronously rendered diffs.

${index % 4 === 0 ? `\`\`\`tsx\n${code}\n\`\`\`\n\n\`\`\`bash\nbun typecheck\nbun test --preload ./happydom.ts ./src/pages/session\ngit diff --check\n\`\`\`` : "- preserve the viewport anchor\n- avoid replacing stable Markdown nodes\n- process provider deltas without blocking input"}`
}

function historicalSource(index: number, updated: boolean) {
  const method = updated ? "toLocaleUpperCase(props.locale)" : "toUpperCase()"
  const limit = updated ? 24 : 20
  return `import { createMemo, For } from "solid-js"

type Message = {
  id: string
  role: "user" | "assistant"
  text: string
  tokens: { input: number; output: number }
}

export function MessageSummary(props: { messages: Message[]; locale: string }) {
  const visible = createMemo(() => props.messages.filter((message) => message.text.trim()).slice(-${limit}))
  const total = createMemo(() => visible().reduce((sum, message) => sum + message.tokens.output, 0))
  return (
    <article data-session-index="${index}">
      <header>{total().toLocaleString(props.locale)} output tokens</header>
      <For each={visible()}>{(message) => <p data-role={message.role}>{message.text.${method}}</p>}</For>
    </article>
  )
}
`
}

function realisticPatch(index: number) {
  return `*** Begin Patch
*** Update File: src/components/SessionCard.tsx
@@
-const title = props.session.title.toUpperCase()
-const messages = props.messages.slice(-20)
+const title = props.session.title.toLocaleUpperCase(props.locale)
+const messages = props.messages.filter((message) => message.text.trim()).slice(-24)
+const outputTokens = messages.reduce((sum, message) => sum + message.tokens.output, 0)
@@
-  <h2>{title}</h2>
+  <h2 data-session-index="${index}">{title}</h2>
+  <span>{outputTokens.toLocaleString(props.locale)} output tokens</span>
*** End Patch`
}

function streamChunk(index: number, count: number) {
  if (index === 0) return `\n\n## Implementation plan\n\nStreaming **bold analysis`
  if (index === count - 1)
    return `\n\`\`\`\n\n## Verification\n\n- **Typecheck:** passed\n- **Timeline geometry:** stable\n- **Streaming output:** benchmark-complete <!-- stream-${index} -->`

  const section = Math.floor(index / 18) + 1
  const fragments = [
    ` continues across three`,
    ` or four word`,
    ` provider deltas and`,
    ` closes in this fragment**. <!-- stream-${index} -->\n\n`,
    `| Concern | State`,
    ` | Verification |\n|`,
    ` --- | ---`,
    ` | --- |\n|`,
    ` markdown | incremental |`,
    ` painted frames | <!-- stream-${index} -->\n\n`,
    `\`\`\`tsx\nconst row: SessionRow`,
    ` = rows[index] ??`,
    ` fallback\nconst title =`,
    ` row.title.toLocaleUpperCase(locale)\n`,
    `const selected = createMemo(()`,
    ` => row.id ===`,
    ` activeID()) // stream-${index}\n`,
    `\`\`\`\n\n### Iteration ${section}\n\nStreaming **bold analysis`,
  ]
  return fragments[(index - 1) % fragments.length]!
}

function project() {
  return {
    id: projectID,
    worktree: directory,
    vcs: "git",
    name: "timeline-state-regression",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  }
}

function session() {
  return {
    id: sessionID,
    slug: "timeline-state-regression",
    projectID,
    directory,
    title,
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
}

function provider() {
  return {
    all: [
      {
        id: "opencode",
        name: "OpenCode",
        models: { "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } } },
      },
    ],
    connected: ["opencode"],
    default: { providerID: "opencode", modelID: "claude-opus-4-6" },
  }
}

function base64Encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}
