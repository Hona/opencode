import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createKeyed } from "../sdk"
import { paper } from "./paper"

/** Paints one page into `canvas` at `scale`; `current` turns false once a newer paint replaces this one. */
export type PaintPage = (index: number, canvas: HTMLCanvasElement, scale: number, current: () => boolean) => Promise<void>

/** Content laid over one page while it is near the viewport, in page pixels times `scale`. */
export type PageOverlay = (input: { readonly index: number; readonly scale: number }) => JSX.Element

/** Scrolls the column so a point of a page shows near the top. */
export type ScrollToPage = (index: number, y: number) => void

const padding = 24

/** How long a resize has to settle before visible pages paint again at the new scale. */
const settleDelay = 150

/**
 * A column of pages that fit the pane's width, up to `maxScale`. Only pages near the viewport hold a bitmap and an
 * overlay: a long document would otherwise keep hundreds of page-sized canvases in memory.
 */
export function OfficePages(props: {
  pages: readonly { readonly width: number; readonly height: number; readonly background?: string }[]
  maxScale: number
  paint: PaintPage
  label: (index: number) => string
  /** Laid over each page near the viewport, such as a text layer for selection, links and screen readers. */
  overlay?: PageOverlay
  /** The overlay carries the page's text, so screen readers read it as a page instead of an image. */
  text?: boolean
  /** Shown under each page, such as a slide's speaker notes. */
  footer?: (index: number) => JSX.Element
  /** Receives the column's scroll function once it mounts. */
  onScrollTo?: (scrollTo: ScrollToPage) => void
}) {
  const [width, setWidth] = createSignal(0)
  // The width pages paint at: a resize repaints each visible page once it settles, while the CSS size follows at once.
  const [settled, setSettled] = createSignal(0)
  const [ratio, setRatio] = createSignal(window.devicePixelRatio || 1)
  const pages: HTMLDivElement[] = []
  let scroller: HTMLDivElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  createResizeObserver(
    () => scroller,
    (rect) => {
      setWidth(rect.width)
      clearTimeout(timer)

      if (settled() === 0) return void setSettled(rect.width)

      timer = setTimeout(() => setSettled(rect.width), settleDelay)
    },
  )

  onCleanup(() => clearTimeout(timer))

  // Syncs with the display's pixel ratio, which changes when the window moves to another screen. A media query
  // matches one ratio, so each new ratio arms a new one.
  createKeyed(ratio, (value) => {
    const query = window.matchMedia(`(resolution: ${value}dppx)`)
    const change = () => setRatio(window.devicePixelRatio || 1)

    query.addEventListener("change", change)
    onCleanup(() => query.removeEventListener("change", change))
  })

  onMount(() =>
    props.onScrollTo?.((index, y) => {
      const page = pages[index]
      const target = props.pages[index]

      if (!scroller || !page || !target) return

      scroller.scrollTo({ top: page.offsetTop + y * fit(width(), target.width) - padding })
    }),
  )

  const fit = (available: number, page: number) => Math.max(0, Math.min(props.maxScale, (available - padding * 2) / page))

  return (
    <div ref={scroller} data-slot="artifact-stage" class="relative min-h-0 flex-1 overflow-auto">
      <div class="flex flex-col items-center gap-4 py-6">
        <For each={props.pages}>
          {(page, index) => (
            <div class="flex shrink-0 flex-col items-center gap-3">
              <OfficePage
                ref={(element) => (pages[index()] = element)}
                index={index()}
                width={page.width}
                height={page.height}
                background={page.background}
                scale={fit(width(), page.width)}
                rasterScale={fit(settled(), page.width)}
                ratio={ratio()}
                paint={props.paint}
                overlay={props.overlay}
                text={props.text ?? false}
                label={props.label(index())}
              />
              {props.footer?.(index())}
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

function OfficePage(props: {
  ref: (element: HTMLDivElement) => void
  index: number
  width: number
  height: number
  background: string | undefined
  scale: number
  rasterScale: number
  ratio: number
  paint: PaintPage
  overlay: PageOverlay | undefined
  text: boolean
  label: string
}) {
  const [visible, setVisible] = createSignal(false)
  let frame: HTMLDivElement | undefined
  let canvas: HTMLCanvasElement | undefined

  onMount(() => {
    if (!frame) return

    // Paint a viewport ahead in both directions, so scrolling rarely reaches a blank page.
    // The column clips its pages, so the margin applies to it: an observer of the window would only see what shows.
    const observer = new IntersectionObserver((entries) => setVisible(entries.some((entry) => entry.isIntersecting)), {
      root: frame.closest("[data-slot=artifact-stage]"),
      rootMargin: "100% 0px",
    })

    observer.observe(frame)
    onCleanup(() => observer.disconnect())
  })

  const raster = createMemo(
    () => (visible() && props.rasterScale > 0 ? { scale: props.rasterScale, ratio: props.ratio } : false),
    undefined,
    { equals: (previous, next) => previous === next || (!!previous && !!next && previous.scale === next.scale && previous.ratio === next.ratio) },
  )

  // Syncs the canvas bitmap with the page's visibility, scale and the display's pixel ratio.
  createKeyed(
    raster,
    (value) => {
      const target = canvas

      if (!target) return

      const state = { current: true }

      onCleanup(() => {
        state.current = false
      })
      void props.paint(props.index, target, value.scale, () => state.current).catch(() => undefined)
    },
    {
      otherwise: () => {
        if (!canvas) return

        canvas.width = 0
        canvas.height = 0
      },
    },
  )

  return (
    <div
      ref={(element) => {
        frame = element
        props.ref(element)
      }}
      role={props.text ? "group" : undefined}
      aria-label={props.text ? props.label : undefined}
      class="relative shrink-0 shadow-[var(--v2-elevation-raised)]"
      style={{
        width: `${props.width * props.scale}px`,
        height: `${props.height * props.scale}px`,
        // Paper keeps the document's own colour in every theme, as it would print.
        background: props.background ?? paper,
      }}
    >
      <canvas
        ref={canvas}
        role={props.text ? undefined : "img"}
        aria-label={props.text ? undefined : props.label}
        aria-hidden={props.text ? "true" : undefined}
        class="absolute inset-0 block size-full"
      />
      <Show when={visible() && props.overlay}>{(overlay) => overlay()({ index: props.index, scale: props.scale })}</Show>
    </div>
  )
}
