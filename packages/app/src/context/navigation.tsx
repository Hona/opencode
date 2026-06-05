import { createContext, type Accessor, type ParentProps, useContext } from "solid-js"

export type Navigation = {
  session: (sessionID: string) => string
  openSession: (sessionID: string) => void
  newSession: () => void
  selectDirectory: (directory: string) => void
  created: (session: { id: string; directory: string }) => void
}

const Context = createContext<Accessor<Navigation>>()

export function NavigationProvider(props: ParentProps<{ value: Accessor<Navigation> }>) {
  return <Context.Provider value={props.value}>{props.children}</Context.Provider>
}

export function useNavigation() {
  const navigation = useContext(Context)
  if (!navigation) throw new Error("Navigation must be used within NavigationProvider")
  return navigation
}
