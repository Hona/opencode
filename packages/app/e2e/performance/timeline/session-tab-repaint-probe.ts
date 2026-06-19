import type { Page } from "@playwright/test"

type CachedRepaintTrace = {
  started: number
  frames: {
    at: number
    root: number | undefined
    scrollTop: number
    scrollHeight: number
    bottomError: number | undefined
    last: boolean
    rows: { key: string | undefined; node: number; top: number; bottom: number }[]
    mounted: number
    center: string | undefined
  }[]
  mutations: { at: number; changed: { type: string; node: number }[] }[]
  shifts: { at: number; value: number }[]
  running: boolean
}

export async function installCachedRepaintProbe(
  page: Page,
  input: { targetHref: string; destination: string[]; last: string },
) {
  await page.evaluate(({ targetHref, destination, last }) => {
    const ids = new Set(destination)
    const nodeIDs = new WeakMap<Node, number>()
    let nextNodeID = 1
    const id = (node: Node) => {
      const current = nodeIDs.get(node)
      if (current) return current
      nodeIDs.set(node, nextNodeID)
      return nextNodeID++
    }
    const state: CachedRepaintTrace = {
      started: 0,
      frames: [],
      mutations: [],
      shifts: [],
      running: false,
    }
    new PerformanceObserver((entries) => {
      if (!state.running) return
      state.shifts.push(
        ...entries
          .getEntries()
          .map((entry) => {
            if (entry.startTime < state.started) return
            return { at: entry.startTime - state.started, value: (entry as PerformanceEntry & { value: number }).value }
          })
          .filter((entry): entry is { at: number; value: number } => entry !== undefined),
      )
    }).observe({ type: "layout-shift" })
    new MutationObserver((entries) => {
      if (!state.running) return
      const changed = entries.flatMap((entry) => [
        ...[...entry.addedNodes].map((node) => ({ type: "add", node: id(node) })),
        ...[...entry.removedNodes].map((node) => ({ type: "remove", node: id(node) })),
      ])
      if (changed.length) state.mutations.push({ at: performance.now() - state.started, changed })
    }).observe(document.documentElement, { childList: true, subtree: true })
    const sample = () => {
      if (!state.running) return
      setTimeout(() => {
        if (!state.running) return
        const root = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((element) =>
          element.querySelector("[data-timeline-row]"),
        )
        if (root) {
          const view = root.getBoundingClientRect()
          const rows = [...root.querySelectorAll<HTMLElement>("[data-timeline-key]")]
            .map((element) => ({
              key: element.dataset.timelineKey,
              node: id(element),
              rect: element.getBoundingClientRect(),
            }))
            .filter((item) => item.rect.bottom > view.top && item.rect.top < view.bottom)
            .map((item) => ({
              key: item.key,
              node: item.node,
              top: item.rect.top - view.top,
              bottom: item.rect.bottom - view.top,
            }))
          const messages = [...root.querySelectorAll<HTMLElement>("[data-message-id]")]
            .filter((element) => {
              const rect = element.getBoundingClientRect()
              return rect.bottom > view.top && rect.top < view.bottom
            })
            .map((element) => element.dataset.messageId!)
            .filter((messageID) => ids.has(messageID))
          const spacer = root.querySelector<HTMLElement>('[data-timeline-row="bottom-spacer"]')?.getBoundingClientRect()
          state.frames.push({
            at: performance.now() - state.started,
            root: id(root),
            scrollTop: root.scrollTop,
            scrollHeight: root.scrollHeight,
            bottomError: spacer ? spacer.bottom - view.bottom : undefined,
            last: messages.includes(last),
            rows,
            mounted: root.querySelectorAll("[data-timeline-key]").length,
            center: document
              .elementFromPoint(view.left + view.width / 2, view.top + view.height / 2)
              ?.textContent?.slice(0, 80),
          })
        } else {
          state.frames.push({
            at: performance.now() - state.started,
            root: undefined,
            scrollTop: 0,
            scrollHeight: 0,
            bottomError: undefined,
            last: false,
            rows: [],
            mounted: 0,
            center: document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.textContent?.slice(0, 80),
          })
        }
        requestAnimationFrame(sample)
      }, 0)
    }
    document.addEventListener(
      "click",
      (event) => {
        const link = event.target instanceof Element ? event.target.closest("a") : undefined
        if (link?.getAttribute("href") !== targetHref) return
        state.started = performance.now()
        state.running = true
        requestAnimationFrame(sample)
      },
      { capture: true, once: true },
    )
    ;(window as Window & { __cachedFlash?: CachedRepaintTrace }).__cachedFlash = state
  }, input)
}

export function layoutShiftSample(entry: Pick<PerformanceEntry, "startTime"> & { value: number }, started: number) {
  if (entry.startTime < started) return
  return { at: entry.startTime - started, value: entry.value }
}

export async function collectCachedRepaintTrace(page: Page) {
  return page.evaluate(() => {
    const state = (window as Window & { __cachedFlash?: CachedRepaintTrace }).__cachedFlash!
    state.running = false
    return state
  })
}

export function summarizeCachedRepaintTrace(trace: CachedRepaintTrace) {
  const roots = trace.frames.map((frame) => frame.root)
  const bottomErrors = trace.frames.flatMap((frame) =>
    frame.bottomError === undefined ? [] : [Math.abs(frame.bottomError)],
  )
  return {
    frames: trace.frames.length,
    durationMs: trace.frames.at(-1)?.at ?? 0,
    firstFrameMs: trace.frames[0]?.at,
    firstFrameCorrect: trace.frames[0]?.last === true && Math.abs(trace.frames[0].bottomError ?? Infinity) <= 1,
    blankFrames: trace.frames.filter((frame) => frame.root === undefined || frame.rows.length === 0).length,
    wrongDestinationFrames: trace.frames.filter((frame) => frame.root !== undefined && !frame.last).length,
    rootChanges: roots.slice(1).filter((root, index) => root !== roots[index]).length,
    mountedMin: trace.frames.length ? Math.min(...trace.frames.map((frame) => frame.mounted)) : 0,
    mountedMax: Math.max(...trace.frames.map((frame) => frame.mounted)),
    maxBottomError: Math.max(0, ...bottomErrors),
    mutationBatches: trace.mutations.length,
    addedNodes: trace.mutations.reduce(
      (sum, batch) => sum + batch.changed.filter((change) => change.type === "add").length,
      0,
    ),
    removedNodes: trace.mutations.reduce(
      (sum, batch) => sum + batch.changed.filter((change) => change.type === "remove").length,
      0,
    ),
    layoutShift: trace.shifts.reduce((sum, shift) => sum + shift.value, 0),
    maxLayoutShift: Math.max(0, ...trace.shifts.map((shift) => shift.value)),
  }
}

export function compressCachedRepaintTrace(trace: CachedRepaintTrace) {
  const frames: { at: number[]; state: Omit<CachedRepaintTrace["frames"][number], "at"> }[] = []
  for (const frame of trace.frames) {
    const { at, ...state } = frame
    const previous = frames.at(-1)
    if (previous && JSON.stringify(previous.state) === JSON.stringify(state)) {
      previous.at.push(at)
      continue
    }
    frames.push({ at: [at], state })
  }
  return {
    started: trace.started,
    summary: summarizeCachedRepaintTrace(trace),
    frames,
    mutations: trace.mutations,
    shifts: trace.shifts,
  }
}
