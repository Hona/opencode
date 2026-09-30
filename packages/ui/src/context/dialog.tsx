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
  // A dialog is closing from the moment its close starts until its exit animation ends and it is disposed.
  const closing = new Map<string, ReturnType<typeof setTimeout> | undefined>()
  const lock = { value: false }

  const disposeAll = () => {
    closing.forEach((timer) => clearTimeout(timer))
    closing.clear()
    stack().forEach((item) => item.dispose())
  }

  onCleanup(disposeAll)

  const finish = (current: Active) => {
    current.onClose?.()
    current.setClosing(true)
    closing.set(
      current.id,
      setTimeout(() => {
        current.dispose()
        setStack((items) => items.filter((item) => item.id !== current.id))
        closing.delete(current.id)
        if (closing.size === 0) lock.value = false
      }, 100),
    )
  }

  /** Programmatic close. Without an id it closes the top dialog, one at a time; with an id it never waits. */
  const close = (id?: string) => {
    const current = id ? stack().find((item) => item.id === id) : stack().at(-1)
    if (!current || closing.has(current.id) || (!id && lock.value)) return
    closing.set(current.id, undefined)
    lock.value = true
    finish(current)
  }

  /** Escape, a backdrop click, or Kobalte dismissing: only the top dialog, and one per exit animation. */
  const dismiss = (id?: string) => {
    const current = stack().at(-1)
    if (!current || (id && current.id !== id) || closing.has(current.id) || lock.value) return
    closing.set(current.id, undefined)
    lock.value = true
    finish(current)
  }

  createEffect(() => {
    if (stack().length === 0) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      dismiss()
      event.preventDefault()
      event.stopPropagation()
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })

  const mount = (element: DialogElement, owner: Owner, onClose: (() => void) | undefined, key?: string) => {
    const id = key ?? Math.random().toString(36).slice(2)
    // The layer follows the dialog's current place in the stack, so a new top dialog always renders above.
    const layer = () => Math.max(0, stack().findIndex((item) => item.id === id))
    const zIndex = () => String(50 + layer() * 10)
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
              if (!open) dismiss(id)
            }}
          >
            <Kobalte.Portal>
              <Kobalte.Overlay
                data-component="dialog-overlay"
                style={{ "z-index": zIndex() }}
                onClick={() => {
                  if (backdropDismiss()) dismiss(id)
                }}
              />
              <div
                data-dialog-layer={layer()}
                style={{
                  position: "fixed",
                  inset: "0",
                  "z-index": zIndex(),
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
    mount(element, owner, onClose, id)
  }

  const show = (element: DialogElement, owner: Owner, onClose?: () => void, id?: string) => {
    disposeAll()
    setStack([])
    lock.value = false
    mount(element, owner, onClose, id)
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
