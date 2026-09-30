import {
  createContext,
  createEffect,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  type Owner,
  type ParentProps,
  runWithOwner,
  useContext,
  type JSX,
  startTransition,
  For,
} from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { makeEventListener } from "@solid-primitives/event-listener"

type DialogElement = () => JSX.Element

type Active = {
  id: string
  node: JSX.Element
  dispose: () => void
  owner: Owner
  onClose?: () => void
  setClosing: (closing: boolean) => void
}

const Context = createContext<ReturnType<typeof init>>()
// Lets the dialog rendered in a layer opt out of closing on a backdrop click.
const LayerContext = createContext<{ setBackdropDismiss: (value: boolean) => void }>()

export function useDialogLayer() {
  return useContext(LayerContext)
}

function init() {
  const [stack, setStack] = createSignal<Active[]>([])
  // Each closing dialog disposes after its own exit animation.
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const lock = { value: false }
  const clearTimers = () => {
    timers.forEach((timer) => clearTimeout(timer))
    timers.clear()
  }

  onCleanup(clearTimers)

  const close = (id?: string) => {
    const items = stack()
    const current = id ? items.find((item) => item.id === id) : items.at(-1)
    // One Escape or backdrop click closes one dialog; closing a dialog by id never waits for another.
    if (!current || timers.has(current.id) || (!id && lock.value)) return
    lock.value = true
    current.onClose?.()
    current.setClosing(true)
    timers.set(
      current.id,
      setTimeout(() => {
        timers.delete(current.id)
        current.dispose()
        setStack((items) => items.filter((item) => item.id !== current.id))
        if (timers.size === 0) lock.value = false
      }, 100),
    )
  }

  createEffect(() => {
    if (stack().length === 0) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      close()
      event.preventDefault()
      event.stopPropagation()
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })

  const mount = (element: DialogElement, owner: Owner, onClose: (() => void) | undefined, layer: number, key?: string) => {
    const id = key ?? Math.random().toString(36).slice(2)
    const zIndex = 50 + layer * 10
    let dispose: (() => void) | undefined
    let setClosing: ((closing: boolean) => void) | undefined

    // Stacked dialogs render as sibling portals, so only the top layer may own the focus trap.
    const node = runWithOwner(owner, () =>
      createRoot((d: () => void) => {
        dispose = d
        const [closing, setClosingSignal] = createSignal(false)
        const [backdropDismiss, setBackdropDismiss] = createSignal(true)
        setClosing = setClosingSignal
        return (
          <Kobalte
            modal={stack().at(-1)?.id === id}
            open={!closing()}
            onOpenChange={(open: boolean) => {
              if (open || stack().at(-1)?.id !== id) return
              close(id)
            }}
          >
            <Kobalte.Portal>
              <Kobalte.Overlay
                data-component="dialog-overlay"
                style={{ "z-index": String(zIndex) }}
                onClick={() => {
                  if (backdropDismiss()) close(id)
                }}
              />
              <div
                data-dialog-layer={layer}
                style={{
                  position: "fixed",
                  inset: "0",
                  "z-index": String(zIndex),
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "center",
                  "pointer-events": "none",
                }}
              >
                <LayerContext.Provider value={{ setBackdropDismiss }}>{element()}</LayerContext.Provider>
              </div>
            </Kobalte.Portal>
          </Kobalte>
        )
      }),
    )

    if (!dispose || !setClosing) return

    const active: Active = { id, node, dispose, owner, onClose, setClosing }
    setStack((items) => [...items, active])
  }

  const push = (element: DialogElement, owner: Owner, onClose?: () => void, id?: string) => {
    lock.value = false
    mount(element, owner, onClose, stack().length, id)
  }

  const show = (element: DialogElement, owner: Owner, onClose?: () => void, id?: string) => {
    for (const item of stack()) item.dispose()
    setStack([])
    clearTimers()
    lock.value = false
    mount(element, owner, onClose, 0, id)
  }

  return {
    stack,
    close,
    show,
    push,
  }
}

export function DialogProvider(props: ParentProps) {
  const ctx = init()
  return (
    <Context.Provider value={ctx}>
      {props.children}
      <div data-component="dialog-stack">
        <For each={ctx.stack()}>{(item) => item.node}</For>
      </div>
    </Context.Provider>
  )
}

export function useDialog() {
  const ctx = useContext(Context)
  const owner = getOwner()

  if (!owner) {
    throw new Error("useDialog must be used within a DialogProvider")
  }
  if (!ctx) {
    throw new Error("useDialog must be used within a DialogProvider")
  }

  return {
    get active() {
      return ctx.stack().at(-1)
    },
    /** id lets the caller close this dialog later rather than whichever is on top. */
    show(element: DialogElement, onClose?: () => void, id?: string) {
      const base = ctx.stack().at(-1)?.owner ?? owner
      return startTransition(() => ctx.show(element, base, onClose, id))
    },
    push(element: DialogElement, onClose?: () => void, id?: string) {
      const base = ctx.stack().at(-1)?.owner ?? owner
      return startTransition(() => ctx.push(element, base, onClose, id))
    },
    close(id?: string) {
      ctx.close(id)
    },
  }
}
