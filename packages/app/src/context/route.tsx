import { createContext, type Accessor, type ParentProps, useContext } from "solid-js"
import type { ServerConnection } from "./server"

export type AppRoute =
  | { type: "home" }
  | { type: "draft"; draftID: string; server: ServerConnection.Key; directory: string }
  | { type: "session"; server: ServerConnection.Key; directory: string; sessionID: string; tabID: string }

const Context = createContext<() => AppRoute>()

export function RouteProvider(props: ParentProps<{ route: Accessor<AppRoute> }>) {
  return <Context.Provider value={props.route}>{props.children}</Context.Provider>
}

export function useAppRoute() {
  const route = useContext(Context)
  if (!route) throw new Error("App route must be used within RouteProvider")
  return route
}
