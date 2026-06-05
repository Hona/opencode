import { createEffect, createMemo, createRoot, getOwner, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { PermissionRequest } from "@opencode-ai/sdk/v2/client"
import { Persist, persisted } from "@/utils/persist"
import { createScopedCache } from "@/utils/scoped-cache"
import { useGlobal } from "./global"
import { ServerConnection } from "./server"
import { useServerContext, type ServerContext } from "./server-context"
import {
  acceptKey,
  directoryAcceptKey,
  isDirectoryAutoAccepting,
  autoRespondsPermission,
} from "./permission-auto-respond"

type PermissionRespondFn = (input: {
  sessionID: string
  permissionID: string
  response: "once" | "always" | "reject"
  directory?: string
}) => void

function isNonAllowRule(rule: unknown) {
  if (!rule) return false
  if (typeof rule === "string") return rule !== "allow"
  if (typeof rule !== "object") return false
  if (Array.isArray(rule)) return false

  for (const action of Object.values(rule)) {
    if (action !== "allow") return true
  }

  return false
}

function hasPermissionPromptRules(permission: unknown) {
  if (!permission) return false
  if (typeof permission === "string") return permission !== "allow"
  if (typeof permission !== "object") return false
  if (Array.isArray(permission)) return false

  const config = permission as Record<string, unknown>
  return Object.values(config).some(isNonAllowRule)
}

function createPermissionServerState(server: ServerContext) {
  const serverSDK = server.sdk
  const serverSync = server.sync
  const [store, setStore, _, ready] = persisted(
    {
      ...Persist.serverGlobal(server.scope, "permission", ["permission.v3"]),
      migrate(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return value

        const data = value as Record<string, unknown>
        if (data.autoAccept) return value

        return {
          ...data,
          autoAccept:
            typeof data.autoAcceptEdits === "object" && data.autoAcceptEdits && !Array.isArray(data.autoAcceptEdits)
              ? data.autoAcceptEdits
              : {},
        }
      },
    },
    createStore({
      autoAccept: {} as Record<string, boolean>,
    }),
  )

  const MAX_RESPONDED = 1000
  const RESPONDED_TTL_MS = 60 * 60 * 1000
  const responded = new Map<string, number>()
  const enableVersion = new Map<string, number>()

  function pruneResponded(now: number) {
    for (const [id, ts] of responded) {
      if (now - ts < RESPONDED_TTL_MS) break
      responded.delete(id)
    }

    for (const id of responded.keys()) {
      if (responded.size <= MAX_RESPONDED) break
      responded.delete(id)
    }
  }

  const respond: PermissionRespondFn = (input) => {
    serverSDK.client.permission.respond(input).catch(() => {
      responded.delete(input.permissionID)
    })
  }

  function autoAccept(directory?: string) {
    if (!directory) return store.autoAccept
    const key = directoryAcceptKey(directory)
    if (store.autoAccept[key] !== undefined) return store.autoAccept
    if (serverSync.child(directory, { bootstrap: false })[0].config.permission !== "allow") return store.autoAccept
    return { ...store.autoAccept, [key]: true }
  }

  function respondOnce(permission: PermissionRequest, directory?: string) {
    const now = Date.now()
    const hit = responded.has(permission.id)
    responded.delete(permission.id)
    responded.set(permission.id, now)
    pruneResponded(now)
    if (hit) return
    respond({
      sessionID: permission.sessionID,
      permissionID: permission.id,
      response: "once",
      directory,
    })
  }

  function isAutoAccepting(sessionID: string, directory?: string) {
    const session = directory ? serverSync.child(directory, { bootstrap: false })[0].session : []
    return autoRespondsPermission(autoAccept(directory), session, { sessionID }, directory)
  }

  function isAutoAcceptingDirectory(directory: string) {
    return isDirectoryAutoAccepting(autoAccept(directory), directory)
  }

  function shouldAutoRespond(permission: PermissionRequest, directory?: string) {
    const session = directory ? serverSync.child(directory, { bootstrap: false })[0].session : []
    return autoRespondsPermission(autoAccept(directory), session, permission, directory)
  }

  function bumpEnableVersion(sessionID: string, directory?: string) {
    const key = acceptKey(sessionID, directory)
    const next = (enableVersion.get(key) ?? 0) + 1
    enableVersion.set(key, next)
    return next
  }

  const unsubscribe = serverSDK.event.listen((e) => {
    const event = e.details
    if (event?.type !== "permission.asked") return
    if (!shouldAutoRespond(event.properties, e.name)) return
    respondOnce(event.properties, e.name)
  })
  onCleanup(unsubscribe)

  function enableDirectory(directory: string) {
    const key = directoryAcceptKey(directory)
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = true
      }),
    )

    serverSDK.client.permission
      .list({ directory })
      .then((x) => {
        if (!isAutoAcceptingDirectory(directory)) return
        for (const perm of x.data ?? []) {
          if (!perm?.id) continue
          if (!shouldAutoRespond(perm, directory)) continue
          respondOnce(perm, directory)
        }
      })
      .catch(() => undefined)
  }

  function disableDirectory(directory: string) {
    const key = directoryAcceptKey(directory)
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = false
      }),
    )
  }

  function enable(sessionID: string, directory: string) {
    const key = acceptKey(sessionID, directory)
    const version = bumpEnableVersion(sessionID, directory)
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = true
        delete draft.autoAccept[sessionID]
      }),
    )

    serverSDK.client.permission
      .list({ directory })
      .then((x) => {
        if (enableVersion.get(key) !== version) return
        if (!isAutoAccepting(sessionID, directory)) return
        for (const perm of x.data ?? []) {
          if (!perm?.id) continue
          if (!shouldAutoRespond(perm, directory)) continue
          respondOnce(perm, directory)
        }
      })
      .catch(() => undefined)
  }

  function disable(sessionID: string, directory?: string) {
    bumpEnableVersion(sessionID, directory)
    const key = directory ? acceptKey(sessionID, directory) : sessionID
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = false
        if (!directory) return
        delete draft.autoAccept[sessionID]
      }),
    )
  }

  return {
    ready,
    respond,
    autoResponds: shouldAutoRespond,
    isAutoAccepting,
    isAutoAcceptingDirectory,
    enableDirectory,
    disableDirectory,
    enable,
    disable,
    isPermissionAllowAll(directory: string) {
      return serverSync.child(directory)[0].config.permission === "allow"
    },
    permissionsEnabled(directory: string) {
      return hasPermissionPromptRules(serverSync.child(directory)[0].config.permission)
    },
  }
}

const { use: usePermissionService, provider: PermissionServiceProvider } = createSimpleContext({
  name: "PermissionService",
  gate: false,
  init: () => {
    const global = useGlobal()
    const owner = getOwner()
    const cache = createScopedCache(
      (current: ServerContext) => {
        const entry = createRoot((dispose) => ({ value: createPermissionServerState(current), dispose }), owner)
        return { ...entry, unregister: current.onDispose(() => cache.delete(current)) }
      },
      {
        dispose: (entry) => {
          entry.unregister()
          entry.dispose()
        },
      },
    )
    onCleanup(() => cache.clear())
    createEffect(() => {
      global.servers.list().forEach((connection) => cache.get(global.servers.get(ServerConnection.key(connection))))
    })

    return { forServer: (server: ServerContext) => cache.get(server).value }
  },
})

export { PermissionServiceProvider }

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  gate: false,
  init: (props: { directory: () => string | undefined }) => {
    const server = useServerContext()
    const service = usePermissionService()

    const current = createMemo(() => service.forServer(server()))

    const permissionsEnabled = createMemo(() => {
      const directory = props.directory()
      if (!directory) return false
      return current().permissionsEnabled(directory)
    })

    return {
      forServer: service.forServer,
      bind() {
        const state = current()
        return {
          enableAutoAccept(sessionID: string, directory: string) {
            if (!state.isAutoAccepting(sessionID, directory)) state.enable(sessionID, directory)
          },
        }
      },
      ready: () => current().ready(),
      respond: (input: Parameters<PermissionRespondFn>[0]) => current().respond(input),
      autoResponds(permission: PermissionRequest, directory?: string) {
        return current().autoResponds(permission, directory)
      },
      isAutoAccepting: (sessionID: string, directory?: string) => current().isAutoAccepting(sessionID, directory),
      isAutoAcceptingDirectory: (directory: string) => current().isAutoAcceptingDirectory(directory),
      toggleAutoAccept(sessionID: string, directory: string) {
        const state = current()
        if (state.isAutoAccepting(sessionID, directory)) {
          state.disable(sessionID, directory)
          return
        }
        state.enable(sessionID, directory)
      },
      toggleAutoAcceptDirectory(directory: string) {
        const state = current()
        if (state.isAutoAcceptingDirectory(directory)) {
          state.disableDirectory(directory)
          return
        }
        state.enableDirectory(directory)
      },
      enableAutoAccept(sessionID: string, directory: string) {
        const state = current()
        if (state.isAutoAccepting(sessionID, directory)) return
        state.enable(sessionID, directory)
      },
      disableAutoAccept(sessionID: string, directory?: string) {
        current().disable(sessionID, directory)
      },
      permissionsEnabled,
      isPermissionAllowAll(directory: string) {
        return current().isPermissionAllowAll(directory)
      },
    }
  },
})
