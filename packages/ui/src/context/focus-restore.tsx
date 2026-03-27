import { createContext, createSignal, type ParentProps, useContext } from "solid-js"

type Restore = () => void

type Focus = {
  current: () => Restore | undefined
  set: (value?: Restore) => void
  run: () => void
}

const fallback: Focus = {
  current: () => undefined,
  set() {},
  run() {},
}

const Context = createContext<Focus>(fallback)

export function FocusRestoreProvider(props: ParentProps) {
  const [current, setCurrent] = createSignal<Restore | undefined>()
  return (
    <Context.Provider
      value={{
        current,
        set(value?: Restore) {
          setCurrent(() => value)
        },
        run() {
          current()?.()
        },
      }}
    >
      {props.children}
    </Context.Provider>
  )
}

export function useFocusRestore() {
  return useContext(Context)
}
