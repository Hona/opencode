import { createMemo, onCleanup, onMount, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { same } from "@/runtime/persistence/equality"

const emptyTabs: string[] = []

/** File tabs in a session's side panel strip, read through the file model's tab keys. */
export const createFileTabs = (input: {
  tabs: Accessor<{ active: Accessor<string | undefined>; all: Accessor<string[]> }>
  pathFromTab: (tab: string) => string | undefined
  normalizeTab: (tab: string) => string
}) => {
  const opened = createMemo(
    () =>
      Array.from(
        new Set(
          input
            .tabs()
            .all()
            .flatMap((tab) => (input.pathFromTab(tab) ? [input.normalizeTab(tab)] : [])),
        ),
      ),
    emptyTabs,
    { equals: same },
  )
  const active = createMemo<string | undefined>(() => {
    const value = input.tabs().active()
    if (value && input.pathFromTab(value)) return input.normalizeTab(value)
    // A stale selection falls back to the first file tab, like the side panel does.
    if (!value || !input.tabs().all().includes(value)) return opened()[0]
  })
  return { opened, active }
}

export const createSizing = () => {
  const [state, setState] = createStore({ active: false })
  let t: number | undefined

  const stop = () => {
    if (t !== undefined) {
      clearTimeout(t)
      t = undefined
    }
    setState("active", false)
  }

  const start = () => {
    if (t !== undefined) {
      clearTimeout(t)
      t = undefined
    }
    setState("active", true)
  }

  onMount(() => {
    makeEventListener(window, "pointerup", stop)
    makeEventListener(window, "pointercancel", stop)
    makeEventListener(window, "blur", stop)
  })

  onCleanup(() => {
    if (t !== undefined) clearTimeout(t)
  })

  return {
    active: () => state.active,
    start,
    touch() {
      start()
      t = window.setTimeout(stop, 120)
    },
  }
}

export type Sizing = ReturnType<typeof createSizing>
