import { createMemo, type Accessor } from "solid-js"
import { useGlobal } from "@/context/global"
import type { ServerConnection } from "@/context/server"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { sessionPermissionRequest } from "@/pages/session/composer/session-request-tree"

export function useSessionTabAvatarState(
  server: Accessor<ServerConnection.Key>,
  directory: Accessor<string>,
  sessionId: Accessor<string>,
) {
  const global = useGlobal()
  const notification = useNotification()
  const permission = usePermission()
  const context = createMemo(() => global.servers.get(server()))
  const globalSync = () => context().sync
  const notifications = () => notification.forServer(context())
  const permissions = () => permission.forServer(context())
  const hasPermissions = createMemo(() => {
    const [store] = globalSync().child(directory(), { bootstrap: false })
    return !!sessionPermissionRequest(store.session, store.permission, sessionId(), (item) => {
      return !permissions().autoResponds(item, directory())
    })
  })
  const unread = createMemo(() => hasPermissions() || notifications().session.unseenCount(sessionId()) > 0)
  const loading = createMemo(() => {
    if (hasPermissions()) return false
    const [store] = globalSync().child(directory(), { bootstrap: false })
    return store.session_working(sessionId())
  })
  return { unread, loading }
}
