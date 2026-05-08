import { Show, createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { TextShimmer } from "./text-shimmer"

function common(active: string, done: string) {
  const a = Array.from(active)
  const b = Array.from(done)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return {
    prefix: a.slice(0, i).join(""),
    active: a.slice(i).join(""),
    done: b.slice(i).join(""),
  }
}

function contentWidth(el: HTMLSpanElement | undefined) {
  if (!el) return
  return `${Math.ceil(el.getBoundingClientRect().width)}px`
}

function flipElements(el: HTMLSpanElement | undefined) {
  const row = el?.closest('[data-slot="context-tool-group-title"]')
  if (row instanceof HTMLElement) return [...row.children].filter((item) => item instanceof HTMLElement)
  if (el?.parentElement) return [el.parentElement]
  return el ? [el] : []
}

function flipRects(elements: HTMLElement[]) {
  return new Map(elements.map((element) => [element, element.getBoundingClientRect()]))
}

export function ToolStatusTitle(props: {
  active: boolean
  activeText: string
  doneText: string
  class?: string
  split?: boolean
}) {
  const split = createMemo(() => common(props.activeText, props.doneText))
  const suffix = createMemo(
    () => (props.split ?? true) && split().prefix.length >= 2 && split().active.length > 0 && split().done.length > 0,
  )
  const prefixLen = createMemo(() => Array.from(split().prefix).length)
  const activeTail = createMemo(() => (suffix() ? split().active : props.activeText))
  const doneTail = createMemo(() => (suffix() ? split().done : props.doneText))

  const [state, setState] = createStore({
    active: props.active,
    animating: false,
    width: undefined as string | undefined,
  })
  const width = () => state.width
  const active = () => state.active
  const animating = () => state.animating
  let rootRef: HTMLSpanElement | undefined
  let activeRef: HTMLSpanElement | undefined
  let doneRef: HTMLSpanElement | undefined
  let widthRef: HTMLSpanElement | undefined
  let frame: number | undefined
  let finishTimer: ReturnType<typeof setTimeout> | undefined
  let animations: Animation[] = []

  const finish = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    if (finishTimer !== undefined) clearTimeout(finishTimer)
    for (const animation of animations) animation.cancel()
    frame = undefined
    finishTimer = undefined
    animations = []
    setState("animating", false)
    setState("width", undefined)
  }

  const play = (firstRects: Map<HTMLElement, DOMRect>, elements: HTMLElement[]) => {
    const style = rootRef ? getComputedStyle(rootRef) : undefined
    const duration = Number.parseFloat(style?.getPropertyValue("--tool-motion-spring-ms") ?? "") || 480
    const easing = style?.getPropertyValue("--tool-motion-ease") || "cubic-bezier(0.22, 1, 0.36, 1)"

    animations = elements.flatMap((element) => {
      const first = firstRects.get(element)
      if (!first) return []
      const last = element.getBoundingClientRect()
      const x = first.left - last.left
      const y = first.top - last.top
      const scaleX = last.width === 0 ? 1 : first.width / last.width
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5 && Math.abs(scaleX - 1) < 0.01) return []
      return element.animate(
        [
          { transform: `translate(${x}px, ${y}px) scaleX(${scaleX})`, transformOrigin: "top left" },
          { transform: "none", transformOrigin: "top left" },
        ],
        { duration, easing },
      )
    })
  }

  const animate = () => {
    const elements = flipElements(rootRef)
    const firstRects = flipRects(elements)
    finish()
    setState("animating", true)
    setState("active", props.active)
    const last = contentWidth(props.active ? activeRef : doneRef)
    if (!last) {
      finish()
      return
    }

    setState("width", last)
    frame = requestAnimationFrame(() => {
      frame = undefined
      play(firstRects, elements)
      finishTimer = setTimeout(finish, 600)
    })
  }

  createEffect(on([() => props.active, activeTail, doneTail], () => animate(), { defer: true }))

  onCleanup(() => {
    finish()
  })

  return (
    <span
      ref={rootRef}
      data-component="tool-status-title"
      data-active={active() ? "true" : "false"}
      data-ready={animating() ? "true" : "false"}
      data-mode={suffix() ? "suffix" : "swap"}
      class={props.class}
      aria-label={active() ? props.activeText : props.doneText}
    >
      <Show
        when={suffix()}
        fallback={
          <span data-slot="tool-status-swap" ref={widthRef} style={{ width: width() }}>
            <Show when={animating() || active()}>
              <span data-slot="tool-status-active" ref={activeRef}>
                <TextShimmer text={activeTail()} active={active()} offset={0} />
              </span>
            </Show>
            <Show when={animating() || !active()}>
              <span data-slot="tool-status-done" ref={doneRef}>
                <TextShimmer text={doneTail()} active={false} offset={0} />
              </span>
            </Show>
          </span>
        }
      >
        <span data-slot="tool-status-suffix">
          <span data-slot="tool-status-prefix">
            <TextShimmer text={split().prefix} active={active()} offset={0} />
          </span>
          <span data-slot="tool-status-tail" ref={widthRef} style={{ width: width() }}>
            <Show when={animating() || active()}>
              <span data-slot="tool-status-active" ref={activeRef}>
                <TextShimmer text={activeTail()} active={active()} offset={prefixLen()} />
              </span>
            </Show>
            <Show when={animating() || !active()}>
              <span data-slot="tool-status-done" ref={doneRef}>
                <TextShimmer text={doneTail()} active={false} offset={prefixLen()} />
              </span>
            </Show>
          </span>
        </span>
      </Show>
    </span>
  )
}
