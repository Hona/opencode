import type { Page } from "@playwright/test"

const STREAM_MARKER_PATTERN = "stream-(\\d+)"
const STREAM_FRAGMENT_COUNT = 18

type TimelineProbeState = {
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
  visibleRows: Set<Element>
  visibleSubtreeMounts: string[]
  visibleSubtreeUnmounts: string[]
  visibleSubtreeReplacements: number
  paintedSubtreeDropouts: string[]
  paintedSubtrees: Map<string, Element>
  maxOverlap: number
  maxGap: number
  maxPartTopMovement: number
  previousPartTop: number
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
  previous: number
}

export async function installTimelineStreamProbe(
  page: Page,
  options: { textPartID: string; profileVisual: boolean; minimal: boolean },
) {
  await page.evaluate(
    ({ textPartID, profileVisual, minimal, markerPattern, fragmentCount }) => {
      const part = document.querySelector<HTMLElement>(`[data-timeline-part-id="${textPartID}"]`)
      const row = part?.closest<HTMLElement>("[data-timeline-row]")
      const markdown = part?.querySelector<HTMLElement>('[data-component="markdown"]')
      const root = part?.closest<HTMLElement>(".scroll-view__viewport")
      if (!part || !row || !markdown || !root) throw new Error("missing streaming benchmark nodes")
      const probeStart = performance.now()
      const viewport = root.getBoundingClientRect()
      const state: TimelineProbeState = {
        frames: [],
        frameAt: [],
        applied: [],
        geometry: [],
        blanks: 0,
        longTasks: [],
        layoutShifts: [],
        visibleMounts: 0,
        visibleUnmounts: 0,
        visibleRows: new Set(
          [...root.querySelectorAll("[data-timeline-key]")].filter((element) => {
            const rect = element.getBoundingClientRect()
            return rect.bottom > viewport.top && rect.top < viewport.bottom
          }),
        ),
        visibleSubtreeMounts: [],
        visibleSubtreeUnmounts: [],
        visibleSubtreeReplacements: 0,
        paintedSubtreeDropouts: [],
        paintedSubtrees: new Map<string, Element>(),
        maxOverlap: 0,
        maxGap: 0,
        maxPartTopMovement: 0,
        previousPartTop: part.getBoundingClientRect().top,
        slowFrames: [],
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
      ;(window as Window & { __timelineStreamBenchmark?: TimelineProbeState }).__timelineStreamBenchmark = state
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
              .map((entry) => {
                const shift = entry as LayoutShiftEntry
                if (shift.startTime < probeStart || shift.hadRecentInput) return
                return shift.value
              })
              .filter((value): value is number => value !== undefined),
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
              if (node instanceof HTMLElement && node.matches("[data-timeline-key]") && visible(node)) {
                state.visibleMounts += 1
                state.visibleRows.add(node)
              }
              if (!(node instanceof Element)) return
              const added = [node, ...node.querySelectorAll(critical)].filter((element) => element.matches(critical))
              added.forEach((element) => {
                if (visible(element)) state.visibleSubtreeMounts.push(describe(element))
              })
            })
            record.removedNodes.forEach((node) => {
              if (node instanceof HTMLElement && node.matches("[data-timeline-key]") && state.visibleRows.delete(node))
                state.visibleUnmounts += 1
              if (!(node instanceof Element)) return
              const removed = [node, ...node.querySelectorAll(critical)].filter((element) => element.matches(critical))
              removed.forEach((element) => state.visibleSubtreeUnmounts.push(describe(element)))
            })
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
            const visibleRows = [...root.querySelectorAll<HTMLElement>("[data-timeline-key]")]
              .map((element) => ({ element, rect: element.getBoundingClientRect() }))
              .filter((item) => item.rect.bottom > viewport.top && item.rect.top < viewport.bottom)
              .sort((a, b) => a.rect.top - b.rect.top)
            state.visibleRows = new Set(visibleRows.map((item) => item.element))
            const rows = visibleRows.map((item) => item.rect)
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
            const index = Number(content.match(new RegExp(markerPattern, "g"))?.at(-1)?.match(/\d+/)?.[0] ?? -1)
            state.slowFrames.push({
              duration,
              index,
              phase: content.includes("benchmark-complete")
                ? "complete"
                : index >= 0 && index % fragmentCount === 0
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
    { ...options, markerPattern: STREAM_MARKER_PATTERN, fragmentCount: STREAM_FRAGMENT_COUNT },
  )
}

type LayoutShiftEntry = PerformanceEntry & { value: number; hadRecentInput?: boolean }

export function layoutShiftValue(
  entry: Pick<LayoutShiftEntry, "startTime" | "value" | "hadRecentInput">,
  start: number,
) {
  if (entry.startTime < start || entry.hadRecentInput) return
  return entry.value
}

export function removeVisibleRow<T>(visible: Set<T>, row: T) {
  return visible.delete(row)
}

export function streamProgress(content: string) {
  const index = Number(content.match(new RegExp(STREAM_MARKER_PATTERN, "g"))?.at(-1)?.match(/\d+/)?.[0] ?? -1)
  return {
    index,
    phase: content.includes("benchmark-complete")
      ? ("complete" as const)
      : index >= 0 && index % STREAM_FRAGMENT_COUNT === 0
        ? ("boundary" as const)
        : index >= 0
          ? ("code" as const)
          : ("unknown" as const),
  }
}

export async function collectTimelineStreamMetrics(page: Page, options: { textPartID: string; navigations: string[] }) {
  return page.evaluate(({ textPartID, navigations }) => {
    const state = (window as Window & { __timelineStreamBenchmark?: TimelineProbeState }).__timelineStreamBenchmark
    if (!state) throw new Error(`missing streaming benchmark state after navigation: ${JSON.stringify(navigations)}`)
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
      droppedFrameEquivalents: state.frames.reduce((sum, value) => sum + Math.max(0, Math.round(value / 16.67) - 1), 0),
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
  }, options)
}
