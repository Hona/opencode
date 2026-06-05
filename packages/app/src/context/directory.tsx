import { createContext, createMemo, type Accessor, type ParentProps, useContext } from "solid-js"
import { useServerContext, type ServerContext } from "./server-context"
import { Persist, removePersisted, type PersistTarget } from "@/utils/persist"
import type { Platform } from "./platform"
import { ScopedKey, ServerScope, SessionRouteKey, SessionStateKey, type ServerScope as ServerScopeValue } from "@/utils/server-scope"
import { base64Encode } from "@opencode-ai/core/util/encode"

export type DirectorySDK = ReturnType<ServerContext["sdk"]["createDirSdkContext"]>
export type DirectorySync = ReturnType<ServerContext["sync"]["createDirSyncContext"]>

export type DirectoryState = { type: "workspace" } | { type: "draft"; id: string } | { type: "session"; id: string }

export type DirectoryStateScope = {
  serverScope: ServerScopeValue
  directory: string
  state: DirectoryState
}

const DRAFT_SCOPE = "draft" as ServerScopeValue
const DRAFT_PERSISTED_KEYS = ["prompt", "comments", "model-selection", "file-view", "layout"]

export const DirectoryState = {
  sessionID(state: DirectoryState) {
    if (state.type === "session") return state.id
  },
  key(scope: DirectoryStateScope) {
    if (scope.state.type === "draft") return ScopedKey.from(DRAFT_SCOPE, scope.state.id)
    if (scope.state.type === "session") {
      return ScopedKey.from(scope.serverScope, "session", scope.directory, scope.state.id)
    }
    return ScopedKey.from(scope.serverScope, "workspace", scope.directory)
  },
  layoutKey(scope: DirectoryStateScope) {
    if (scope.state.type === "draft") return DirectoryState.key(scope)
    return SessionStateKey.from(
      scope.serverScope,
      SessionRouteKey.fromRoute(base64Encode(scope.directory), DirectoryState.sessionID(scope.state)),
    )
  },
  persist(scope: DirectoryStateScope, key: string, legacy?: string[]): PersistTarget {
    if (scope.state.type === "draft") return Persist.draft(scope.state.id, key)
    if (scope.state.type === "session") {
      return Persist.serverSession(scope.serverScope, scope.directory, scope.state.id, key, legacy)
    }
    return Persist.serverWorkspace(scope.serverScope, scope.directory, key, legacy)
  },
  draftID(key: string) {
    const prefix = ScopedKey.prefix(DRAFT_SCOPE)
    if (!key.startsWith(prefix)) return
    return key.slice(prefix.length)
  },
  removeDraft(draftID: string, platform: Platform) {
    for (const key of DRAFT_PERSISTED_KEYS) removePersisted(Persist.draft(draftID, key), platform)
  },
}

export type DirectoryContext = {
  server: ServerContext
  directory: string
  sessionID: string | undefined
  state: DirectoryState
  sdk: DirectorySDK
  sync: DirectorySync
}

const Context = createContext<Accessor<DirectoryContext>>()

export function DirectoryProvider(
  props: ParentProps<{ directory: Accessor<string>; sessionID: Accessor<string | undefined>; state: Accessor<DirectoryState> }>,
) {
  const server = useServerContext()
  const value = createMemo(() => {
    const current = server()
    const directory = props.directory()
    return {
      server: current,
      directory,
      sessionID: props.sessionID(),
      state: props.state(),
      sdk: current.sdk.createDirSdkContext(directory),
      sync: current.sync.createDirSyncContext(directory),
    }
  })
  return <Context.Provider value={value}>{props.children}</Context.Provider>
}

export function useDirectory() {
  const directory = useContext(Context)
  if (!directory) throw new Error("Directory context must be used within DirectoryProvider")
  return directory
}

export function useSDK(): Accessor<DirectorySDK> {
  const directory = useDirectory()
  return () => directory().sdk
}

export function useSync(): Accessor<DirectorySync> {
  const directory = useDirectory()
  return () => directory().sync
}
