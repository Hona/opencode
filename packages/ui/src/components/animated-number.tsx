import { For, createEffect, createMemo, on } from "solid-js"
import { createStore } from "solid-js/store"

const TRACK = Array.from({ length: 30 }, (_, index) => index % 10)

const DURATION = 600

function normalize(value: number) {
  return ((value % 10) + 10) % 10
}

function spin(from: number, to: number, direction: 1 | -1) {
  if (from === to) return 0

  if (direction > 0) return (to - from + 10) % 10

  return -((from - to + 10) % 10)
}

function Digit(props: { value: number; direction: 1 | -1 }) {
  const [state, setState] = createStore({
    step: props.value + 10,
    animating: false,
  })

  const step = () => state.step
  const animating = () => state.animating
  let last = props.value

  createEffect(
    on(
      () => props.value,
      (next) => {
        const delta = spin(last, next, props.direction)
        last = next

        if (!delta) {
          setState("animating", false)
          setState("step", next + 10)

          return
        }

        setState("animating", true)
        setState("step", (value) => value + delta)
      },
      { defer: true },
    ),
  )

  return (
    <span data-slot="animated-number-digit" data-animating={animating() ? "true" : "false"}>
      <span data-slot="animated-number-static" data-digit={props.value} />
      <span
        data-slot="animated-number-strip"
        onTransitionEnd={() => {
          setState("animating", false)
          setState("step", (value) => normalize(value) + 10)
        }}
        style={{
          "--animated-number-offset": `${step()}`,
          "--animated-number-duration": `var(--tool-motion-odometer-ms, ${DURATION}ms)`,
        }}
      >
        <For each={TRACK}>{(value) => <span data-slot="animated-number-cell" data-digit={value} />}</For>
      </span>
    </span>
  )
}

export function AnimatedNumber(props: { value: number; class?: string }) {
  const target = createMemo(() => {
    if (!Number.isFinite(props.value)) return 0

    return Math.max(0, Math.round(props.value))
  })

  const [state, setState] = createStore<{ value: number; direction: 1 | -1 }>({
    value: target(),
    direction: 1,
  })

  const value = () => state.value
  const direction = () => state.direction

  createEffect(
    on(
      target,
      (next) => {
        const current = value()

        if (next === current) return

        setState("direction", next > current ? 1 : -1)
        setState("value", next)
      },
      { defer: true },
    ),
  )

  const label = createMemo(() => value().toString())

  // Place values, most significant first. Keying by place keeps the ones digit rolling when a tens digit appears.
  const places = createMemo(() => Array.from(label(), (_, index) => label().length - 1 - index))

  return (
    <span data-component="animated-number" class={props.class}>
      {/* The value is the only text: screen readers and copy read it once, in order. CSS draws the digits. */}
      <span class="sr-only">{label()}</span>
      <span
        data-slot="animated-number-value"
        aria-hidden="true"
        style={{ "--animated-number-width": `${label().length}ch` }}
      >
        <For each={places()}>
          {(place) => <Digit value={Math.floor(value() / 10 ** place) % 10} direction={direction()} />}
        </For>
      </span>
    </span>
  )
}
