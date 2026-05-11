import { type Accessor, createEffect, createMemo } from "solid-js"
import { createVirtualizer } from "@tanstack/solid-virtual"

export type TimelineWindowRow = {
  key: string
}

type TimelineWindowConfig = {
  page: number
  overscan: number
}

export function createTimelineWindow<T extends TimelineWindowRow>(input: {
  rows: Accessor<T[]>
  sessionKey: Accessor<string>
  scroller: Accessor<HTMLDivElement | undefined>
  bottom: Accessor<boolean>
  userScrolled: Accessor<boolean>
  estimateSize?: (row: T) => number
  config?: Partial<TimelineWindowConfig>
}) {
  const config: TimelineWindowConfig = {
    page: input.config?.page ?? 20,
    overscan: input.config?.overscan ?? 20,
  }
  const rowIndex = createMemo(() => new Map(input.rows().map((row, index) => [row.key, index] as const)))
  const estimateSize = (index: number) => {
    const row = input.rows()[index]
    if (!row) return 80
    return input.estimateSize?.(row) ?? 80
  }
  const estimateOffset = () => {
    const rows = input.rows()
    const height = input.scroller()?.clientHeight ?? 800
    return Math.max(0, rows.reduce((sum, _row, index) => sum + estimateSize(index), 0) - height)
  }
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return input.rows().length
    },
    getScrollElement: () => input.scroller() ?? null,
    getItemKey: (index) => input.rows()[index]?.key ?? index,
    estimateSize,
    overscan: config.overscan,
    initialOffset: estimateOffset,
  })

  let session = ""
  let rows = 0
  createEffect(() => {
    const key = input.sessionKey()
    const count = input.rows().length
    if (!key || count === 0) return

    if (session !== key) {
      session = key
      rows = count
      requestAnimationFrame(() => virtualizer.scrollToIndex(count - 1, { align: "end" }))
      return
    }

    if (count > rows && !input.userScrolled() && input.bottom()) {
      requestAnimationFrame(() => virtualizer.scrollToIndex(count - 1, { align: "end" }))
    }
    rows = count
  })

  const virtualRows = createMemo(() => virtualizer.getVirtualItems())
  const range = createMemo(() => {
    const items = virtualRows()
    return {
      start: items[0]?.index ?? 0,
      end: (items.at(-1)?.index ?? -1) + 1,
    }
  })
  const visibleRows = createMemo(() =>
    virtualRows()
      .map((item) => input.rows()[item.index])
      .filter((row): row is T => !!row),
  )
  const visibleKeys = createMemo(() => new Set(visibleRows().map((row) => row.key)))
  const topPadding = createMemo(() => virtualRows()[0]?.start ?? 0)
  const bottomPadding = createMemo(() => Math.max(0, virtualizer.getTotalSize() - (virtualRows().at(-1)?.end ?? 0)))

  return {
    range,
    visibleRows,
    visibleKeys,
    topPadding,
    bottomPadding,
    rowIndex: (key: string) => rowIndex().get(key),
    canRevealBefore: () => false,
    canRevealAfter: () => false,
    revealBefore: () => false,
    revealAfter: () => false,
    revealKey: (key: string) => {
      const index = rowIndex().get(key)
      if (index === undefined) return false
      virtualizer.scrollToIndex(index, { align: "center" })
      return true
    },
    nearStart: () => range().start <= config.page,
    nearEnd: () => range().end >= input.rows().length - config.page,
    onScroll: () => {},
    observeRow: (key: string, el: HTMLElement) => {
      const index = rowIndex().get(key)
      if (index === undefined) return
      el.dataset.index = String(index)
      if (el instanceof HTMLDivElement) virtualizer.measureElement(el)
    },
  }
}
