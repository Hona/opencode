import { createMemo, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Loader } from "@opencode/ui/loader"
import { initWasm, openWorkbook, paintDisplayList, type SheetInfo, type WorkbookHandle } from "@betteroffice/xlsx"
import { createKeyed, useExtension } from "../sdk"
import type { FileViewerProps } from "../file/contract"
import { paper } from "./paper"

type Opened = { readonly workbook: WorkbookHandle; readonly info: SheetInfo }

/** How far past the used cells, in CSS pixels, a sheet's charts are looked for. */
const chartSearch = 4096

/** The workbook one opening owns; freed when the bytes change or the view closes. */
type Owned = { workbook: WorkbookHandle | undefined }

/** A read-only Excel workbook with a tab per sheet. */
export default function OfficeSpreadsheet(props: FileViewerProps) {
  const ctx = useExtension()
  const [state, setState] = createStore<{ opened: Opened | undefined }>({ opened: undefined })

  // Syncs one engine workbook with the loaded bytes; it is freed when they change or the view closes.
  createKeyed(
    () => props.bytes,
    (bytes) => {
      const controller = new AbortController()
      const opened: Owned = { workbook: undefined }

      onCleanup(() => {
        controller.abort()
        opened.workbook?.dispose()
        setState({ opened: undefined })
      })

      void initWasm()
        .then(() => {
          if (controller.signal.aborted) return

          const workbook = openWorkbook(bytes)
          const info = workbook.sheetInfo()

          opened.workbook = workbook
          setState({ opened: { workbook, info } })
          props.onDetails([ctx.plural("sheets", info.sheetNames.length)])
        })
        .catch(() => {
          if (!controller.signal.aborted) props.onError()
        })
    },
  )

  const selectSheet = (index: number) => {
    const opened = state.opened

    if (!opened || index === opened.info.activeSheet) return

    opened.workbook.setActiveSheet(index)
    setState("opened", { workbook: opened.workbook, info: opened.workbook.sheetInfo() })
  }

  return (
    <Show
      when={state.opened}
      fallback={
        <div class="flex min-h-0 flex-1 items-center justify-center">
          <Loader />
        </div>
      }
    >
      {(opened) => (
        <div class="flex min-h-0 flex-1 flex-col">
          <SpreadsheetGrid workbook={opened().workbook} info={opened().info} />
          <Show when={opened().info.sheetNames.length > 1}>
            <div
              role="tablist"
              class="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-t border-v2-border-border-muted px-2"
            >
              <For each={opened().info.sheetNames}>
                {(name, index) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={index() === opened().info.activeSheet}
                    class="h-7 shrink-0 rounded-md px-2.5 text-13-regular text-text-weak hover:bg-v2-background-bg-layer-02 aria-selected:bg-v2-background-bg-layer-02 aria-selected:text-text-strong"
                    onClick={() => selectSheet(index())}
                  >
                    {name}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      )}
    </Show>
  )
}

/**
 * The active sheet as one canvas the size of the pane. The engine draws the cells under the scroll position, frozen
 * panes and headers included, so a sheet of any size costs one viewport.
 */
function SpreadsheetGrid(props: { workbook: WorkbookHandle; info: SheetInfo }) {
  let scroller: HTMLDivElement | undefined
  let canvas: HTMLCanvasElement | undefined
  let frame = 0
  // A sheet that just opened scrolls to where the workbook last showed it, once its spacer has its size.
  let opening: SheetInfo | undefined
  // The scroll position and pane size of the last paint.
  const [view, setView] = createStore({ left: 0, top: 0, width: 0, height: 0 })

  // The engine's content extent covers the used cells only, so charts placed beside or below them count too. Only the
  // two strips past the cells are drawn to find them, which stays cheap however many cells the sheet has.
  const used = createMemo(() => {
    const width = props.info.contentWidth
    const height = props.info.contentHeight

    return [
      { x: width, y: 0, width: chartSearch, height: height + chartSearch },
      { x: 0, y: height, width, height: chartSearch },
    ]
      .flatMap((strip) =>
        (props.workbook.displayList(strip).charts ?? []).map((chart) => ({
          width: strip.x + chart.rect.x + chart.rect.w,
          height: strip.y + chart.rect.y + chart.rect.h,
        })),
      )
      .reduce(
        (extent, chart) => ({
          width: Math.max(extent.width, chart.width),
          height: Math.max(extent.height, chart.height),
        }),
        { width, height },
      )
  })

  // As in Excel, the sheet scrolls one screen past the farthest point seen, however far that is.
  const area = () => ({
    width: Math.max(used().width, view.left + view.width) + view.width,
    height: Math.max(used().height, view.top + view.height) + view.height,
  })

  const paint = () => {
    if (!scroller || !canvas) return

    if (opening) {
      scroller.scrollTo({ left: opening.initialScrollX, top: opening.initialScrollY })
      opening = undefined
    }

    const ratio = window.devicePixelRatio || 1
    const width = scroller.clientWidth
    const height = scroller.clientHeight
    const context = canvas.getContext("2d")

    if (!context || width === 0 || height === 0) return

    const left = Math.max(0, scroller.scrollLeft)
    const top = Math.max(0, scroller.scrollTop)

    setView({ left, top, width, height })
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    paintDisplayList(context, props.workbook.displayList({ x: left, y: top, width, height }), ratio)
  }

  // One paint per frame, however many scroll and resize events arrive in it.
  const schedule = () => {
    if (frame) return

    frame = requestAnimationFrame(() => {
      frame = 0
      paint()
    })
  }

  onCleanup(() => cancelAnimationFrame(frame))
  createResizeObserver(() => scroller, schedule)

  // Syncs the canvas with the active sheet.
  createKeyed(
    () => props.info,
    (info) => {
      opening = info
      schedule()
    },
  )

  return (
    // Grids keep their column order in right-to-left layouts, as spreadsheet apps do.
    <div
      ref={scroller}
      dir="ltr"
      class="relative min-h-0 flex-1 overflow-auto"
      // A sheet keeps its own colours in every theme, as Excel shows it.
      style={{ background: paper }}
      onScroll={schedule}
    >
      <div
        class="pointer-events-none absolute left-0 top-0"
        style={{ width: `${area().width}px`, height: `${area().height}px` }}
      />
      <div class="sticky left-0 top-0 h-0 w-0">
        <canvas ref={canvas} class="absolute left-0 top-0 block" />
      </div>
    </div>
  )
}

