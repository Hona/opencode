import { createContext, type Accessor, type ParentProps, useContext } from "solid-js"
import type { ServerConnection, createServerProjects } from "./server"
import type { ServerScope } from "@/utils/server-scope"
import type { ServerSDK } from "./server-sdk"
import type { ServerSync } from "./server-sync"
import type { Project } from "@opencode-ai/sdk/v2/client"

type Projects = Omit<ReturnType<typeof createServerProjects>, "list"> & {
  list: () => Array<ReturnType<ReturnType<typeof createServerProjects>["list"]>[number] & Partial<Project>>
}

export type ServerContext = {
  instance: string
  key: ServerConnection.Key
  connection: ServerConnection.Any
  scope: ServerScope
  sdk: ServerSDK
  sync: ServerSync
  isLocal: boolean
  projects: Projects
  onDispose: (callback: () => void) => () => void
}

const Context = createContext<Accessor<ServerContext>>()

export function ServerContextProvider(props: ParentProps<{ value: Accessor<ServerContext> }>) {
  return <Context.Provider value={props.value}>{props.children}</Context.Provider>
}

export function useServerContext() {
  const server = useContext(Context)
  if (!server) throw new Error("Server context must be used within ServerContextProvider")
  return server
}

export function useServerSDK(): Accessor<ServerSDK> {
  const server = useServerContext()
  return () => server().sdk
}

export function useServerSync(): Accessor<ServerSync> {
  const server = useServerContext()
  return () => server().sync
}
