import { createMemo } from "solid-js"
import { useLayout } from "@/context/layout"
import { DirectoryState, useDirectory } from "@/context/directory"

export const useSessionKey = () => {
  const directory = useDirectory()
  const scope = () => ({
    serverScope: directory().server.scope,
    directory: directory().directory,
    state: directory().state,
  })
  const workspaceKey = createMemo(() =>
    DirectoryState.layoutKey({ ...scope(), state: { type: "workspace" } }),
  )
  const sessionKey = createMemo(() => DirectoryState.layoutKey(scope()))
  return {
    directory: () => directory().directory,
    sessionID: () => directory().sessionID,
    sessionKey,
    workspaceKey,
  }
}

export const useSessionLayout = () => {
  const layout = useLayout()
  const { directory, sessionID, sessionKey, workspaceKey } = useSessionKey()
  return {
    directory,
    sessionID,
    sessionKey,
    workspaceKey,
    tabs: createMemo(() => layout.tabs(sessionKey)),
    view: createMemo(() => layout.view(sessionKey)),
  }
}
