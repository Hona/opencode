import { createSignal, For, onCleanup, onMount } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createKeyed } from "../sdk"
import { paper } from "./paper"

/** Paints one page into `canvas` at `scale`; `current` turns false once a newer paint replaces this one. */
export type PaintPage = (index: number, canvas: HTMLCanvasElement, scale: number, current: () => boolean) => Promise<void>

const padding = 24

/**
 * A column of pages that fit the pane's width, up to `maxScale`. Only pages near the viewport hold a bitmap: a long
 * document would otherwise keep hundreds of page-sized canvases in memory.
 */
export function OfficePages(props: {
  pages: readonly { readonly width: number; readonly height: number; readonly background?: string }[]
  maxScale: number
  paint: PaintPage
  label: (index: number) => string
}) {
  const [width, setWidth] = createSignal(0)
  let scroller: HTMLDivElement | undefined

  createResizeObserver(
    () => scroller,
    (rect) => setWidth(rect.width),
  )

  const scale = (page: { readonly width: number }) =>
    Math.max(0, Math.min(props.maxScale, (width() - padding * 2) / page.width))

  return (
    <div ref={scroller} data-slot="artifact-stage" class="relative min-h-0 flex-1 overflow-auto">
      <div class="flex flex-col items-center gap-4 py-6">
        <For each={props.pages}>
          {(page, index) => (
            <OfficePage
              index={index()}
              width={page.width}
              height={page.height}
              background={page.background}
              scale={scale(page)}
              paint={props.paint}
              label={props.label(index())}
            />
          )}
        </For>
      </div>
    </div>
  )
}

function OfficePage(props: {
  index: number
  width: number
  height: number
  background: string | undefined
  scale: number
  paint: PaintPage
  label: string
}) {
  const [visible, setVisible] = createSignal(false)
  let canvas: HTMLCanvasElement | undefined

  onMount(() => {
    if (!canvas) return

    // Paint a viewport ahead in both directions, so scrolling rarely reaches a blank page.
    const observer = new IntersectionObserver((entries) => setVisible(entries.some((entry) => entry.isIntersecting)), {
      rootMargin: "100% 0px",
    })

    observer.observe(canvas)
    onCleanup(() => observer.disconnect())
  })

  // Syncs the canvas bitmap with the page's visibility and scale.
  createKeyed(
    () => visible() && props.scale > 0 && props.scale,
    (scale) => {
      const target = canvas

      if (!target) return

      const state = { current: true }

      onCleanup(() => {
        state.current = false
      })
      void props.paint(props.index, target, scale, () => state.current).catch(() => undefined)
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
    <canvas
      ref={canvas}
      role="img"
      aria-label={props.label}
      class="block shrink-0 shadow-[var(--v2-elevation-raised)]"
      style={{
        width: `${props.width * props.scale}px`,
        height: `${props.height * props.scale}px`,
        // Paper keeps the document's own colour in every theme, as it would print.
        background: props.background ?? paper,
      }}
    />
  )
}
