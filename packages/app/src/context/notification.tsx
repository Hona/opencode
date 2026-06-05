import { createStore, reconcile } from "solid-js/store"
import { batch, createEffect, createMemo, createRoot, getOwner, onCleanup, type Accessor } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useServerContext, type ServerContext } from "./server-context"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { Binary } from "@opencode-ai/core/util/binary"
import { EventSessionError } from "@opencode-ai/sdk/v2"
import { Persist, persisted } from "@/utils/persist"
import { createScopedCache } from "@/utils/scoped-cache"
import { playSoundById } from "@/utils/sound"
import { useGlobal } from "./global"
import { ServerConnection } from "./server"

type NotificationBase = {
  directory?: string
  session?: string
  metadata?: unknown
  time: number
  viewed: boolean
}

type TurnCompleteNotification = NotificationBase & {
  type: "turn-complete"
}

type ErrorNotification = NotificationBase & {
  type: "error"
  error: EventSessionError["properties"]["error"]
}

export type Notification = TurnCompleteNotification | ErrorNotification

type ActiveNotificationRoute = {
  server: Accessor<ServerContext>
  directory: Accessor<string | undefined>
  sessionID: Accessor<string | undefined>
}

type NotificationIndex = {
  session: {
    all: Record<string, Notification[]>
    unseen: Record<string, Notification[]>
    unseenCount: Record<string, number>
    unseenHasError: Record<string, boolean>
  }
  project: {
    all: Record<string, Notification[]>
    unseen: Record<string, Notification[]>
    unseenCount: Record<string, number>
    unseenHasError: Record<string, boolean>
  }
}

const MAX_NOTIFICATIONS = 500
const NOTIFICATION_TTL_MS = 1000 * 60 * 60 * 24 * 30

function pruneNotifications(list: Notification[]) {
  const cutoff = Date.now() - NOTIFICATION_TTL_MS
  const pruned = list.filter((n) => n.time >= cutoff)
  if (pruned.length <= MAX_NOTIFICATIONS) return pruned
  return pruned.slice(pruned.length - MAX_NOTIFICATIONS)
}

function createNotificationIndex(): NotificationIndex {
  return {
    session: {
      all: {},
      unseen: {},
      unseenCount: {},
      unseenHasError: {},
    },
    project: {
      all: {},
      unseen: {},
      unseenCount: {},
      unseenHasError: {},
    },
  }
}

function buildNotificationIndex(list: Notification[]) {
  const index = createNotificationIndex()

  list.forEach((notification) => {
    if (notification.session) {
      const all = index.session.all[notification.session] ?? []
      index.session.all[notification.session] = [...all, notification]
      if (!notification.viewed) {
        const unseen = index.session.unseen[notification.session] ?? []
        index.session.unseen[notification.session] = [...unseen, notification]
        index.session.unseenCount[notification.session] = unseen.length + 1
        if (notification.type === "error") index.session.unseenHasError[notification.session] = true
      }
    }

    if (notification.directory) {
      const all = index.project.all[notification.directory] ?? []
      index.project.all[notification.directory] = [...all, notification]
      if (!notification.viewed) {
        const unseen = index.project.unseen[notification.directory] ?? []
        index.project.unseen[notification.directory] = [...unseen, notification]
        index.project.unseenCount[notification.directory] = unseen.length + 1
        if (notification.type === "error") index.project.unseenHasError[notification.directory] = true
      }
    }
  })

  return index
}

function createNotificationServerState(input: {
  server: ServerContext
  active: () => ActiveNotificationRoute | undefined
  platform: ReturnType<typeof usePlatform>
  settings: ReturnType<typeof useSettings>
  language: ReturnType<typeof useLanguage>
  href: (server: ServerContext, directory: string, sessionID?: string) => string
}) {
  const empty: Notification[] = []
  const [store, setStore, _, ready] = persisted(
    Persist.serverGlobal(input.server.scope, "notification", ["notification.v1"]),
    createStore({
      list: [] as Notification[],
    }),
  )
  const [index, setIndex] = createStore<NotificationIndex>(buildNotificationIndex(store.list))
  const meta = { disposed: false }

  const updateUnseen = (scope: "session" | "project", key: string, unseen: Notification[]) => {
    setIndex(scope, "unseen", key, unseen)
    setIndex(scope, "unseenCount", key, unseen.length)
    setIndex(
      scope,
      "unseenHasError",
      key,
      unseen.some((notification) => notification.type === "error"),
    )
  }

  const appendToIndex = (notification: Notification) => {
    if (notification.session) {
      setIndex("session", "all", notification.session, (all = []) => [...all, notification])
      if (!notification.viewed) {
        setIndex("session", "unseen", notification.session, (unseen = []) => [...unseen, notification])
        setIndex("session", "unseenCount", notification.session, (count = 0) => count + 1)
        if (notification.type === "error") setIndex("session", "unseenHasError", notification.session, true)
      }
    }

    if (notification.directory) {
      setIndex("project", "all", notification.directory, (all = []) => [...all, notification])
      if (!notification.viewed) {
        setIndex("project", "unseen", notification.directory, (unseen = []) => [...unseen, notification])
        setIndex("project", "unseenCount", notification.directory, (count = 0) => count + 1)
        if (notification.type === "error") setIndex("project", "unseenHasError", notification.directory, true)
      }
    }
  }

  const removeFromIndex = (notification: Notification) => {
    if (notification.session) {
      setIndex("session", "all", notification.session, (all = []) => all.filter((n) => n !== notification))
      if (!notification.viewed) {
        const unseen = (index.session.unseen[notification.session] ?? empty).filter((n) => n !== notification)
        updateUnseen("session", notification.session, unseen)
      }
    }

    if (notification.directory) {
      setIndex("project", "all", notification.directory, (all = []) => all.filter((n) => n !== notification))
      if (!notification.viewed) {
        const unseen = (index.project.unseen[notification.directory] ?? empty).filter((n) => n !== notification)
        updateUnseen("project", notification.directory, unseen)
      }
    }
  }

  void Promise.resolve(ready.promise).then(() => {
    const list = pruneNotifications(store.list)
    batch(() => {
      setStore("list", list)
      setIndex(reconcile(buildNotificationIndex(list), { merge: false }))
    })
  })

  const append = (notification: Notification) => {
    const list = pruneNotifications([...store.list, notification])
    const keep = new Set(list)
    const removed = store.list.filter((n) => !keep.has(n))

    batch(() => {
      if (keep.has(notification)) appendToIndex(notification)
      removed.forEach((n) => removeFromIndex(n))
      setStore("list", list)
    })
  }

  const lookup = async (directory: string, sessionID?: string) => {
    if (!sessionID) return undefined
    const [syncStore] = input.server.sync.child(directory, { bootstrap: false })
    const match = Binary.search(syncStore.session, sessionID, (s) => s.id)
    if (match.found) return syncStore.session[match.index]
    return input.server.sdk.client.session
      .get({ directory, sessionID })
      .then((x) => x.data)
      .catch(() => undefined)
  }

  const viewedInCurrentSession = (directory: string, sessionID?: string) => {
    const active = input.active()
    if (active?.server() !== input.server) return false
    const activeDirectory = active.directory()
    const activeSession = active.sessionID()
    if (!activeDirectory || !activeSession || !sessionID) return false
    if (directory !== activeDirectory) return false
    return sessionID === activeSession
  }

  const handleSessionIdle = (directory: string, event: { properties: { sessionID?: string } }, time: number) => {
    const sessionID = event.properties.sessionID
    void lookup(directory, sessionID).then((session) => {
      if (meta.disposed || !session || session.parentID) return
      if (input.settings.sounds.agentEnabled()) void playSoundById(input.settings.sounds.agent())

      append({
        directory,
        time,
        viewed: viewedInCurrentSession(directory, sessionID),
        type: "turn-complete",
        session: sessionID,
      })

      const href = input.href(input.server, directory, sessionID)
      if (input.settings.notifications.agent()) {
        void input.platform.notify(input.language.t("notification.session.responseReady.title"), session.title ?? sessionID, href)
      }
    })
  }

  const handleSessionError = (
    directory: string,
    event: { properties: { sessionID?: string; error?: EventSessionError["properties"]["error"] } },
    time: number,
  ) => {
    const sessionID = event.properties.sessionID
    void lookup(directory, sessionID).then((session) => {
      if (meta.disposed || session?.parentID) return
      if (input.settings.sounds.errorsEnabled()) void playSoundById(input.settings.sounds.errors())

      const error = "error" in event.properties ? event.properties.error : undefined
      append({
        directory,
        time,
        viewed: viewedInCurrentSession(directory, sessionID),
        type: "error",
        session: sessionID ?? "global",
        error,
      })
      const description =
        session?.title ??
        (typeof error === "string" ? error : input.language.t("notification.session.error.fallbackDescription"))
      const href = input.href(input.server, directory, sessionID)
      if (input.settings.notifications.errors()) {
        void input.platform.notify(input.language.t("notification.session.error.title"), description, href)
      }
    })
  }

  const unsub = input.server.sdk.event.listen((e) => {
    const event = e.details
    if (event.type !== "session.idle" && event.type !== "session.error") return
    const time = Date.now()
    if (event.type === "session.idle") {
      handleSessionIdle(e.name, event, time)
      return
    }
    handleSessionError(e.name, event, time)
  })
  onCleanup(() => {
    meta.disposed = true
    unsub()
  })

  return {
    ready,
    session: {
      all: (session: string) => index.session.all[session] ?? empty,
      unseen: (session: string) => index.session.unseen[session] ?? empty,
      unseenCount: (session: string) => index.session.unseenCount[session] ?? 0,
      unseenHasError: (session: string) => index.session.unseenHasError[session] ?? false,
      markViewed(session: string) {
        const unseen = index.session.unseen[session] ?? empty
        if (!unseen.length) return
        const projects = [
          ...new Set(unseen.flatMap((notification) => (notification.directory ? [notification.directory] : []))),
        ]
        batch(() => {
          setStore("list", (n) => n.session === session && !n.viewed, "viewed", true)
          updateUnseen("session", session, [])
          projects.forEach((directory) => {
            updateUnseen(
              "project",
              directory,
              (index.project.unseen[directory] ?? empty).filter((notification) => notification.session !== session),
            )
          })
        })
      },
    },
    project: {
      all: (directory: string) => index.project.all[directory] ?? empty,
      unseen: (directory: string) => index.project.unseen[directory] ?? empty,
      unseenCount: (directory: string) => index.project.unseenCount[directory] ?? 0,
      unseenHasError: (directory: string) => index.project.unseenHasError[directory] ?? false,
      markViewed(directory: string) {
        const unseen = index.project.unseen[directory] ?? empty
        if (!unseen.length) return
        const sessions = [
          ...new Set(unseen.flatMap((notification) => (notification.session ? [notification.session] : []))),
        ]
        batch(() => {
          setStore("list", (n) => n.directory === directory && !n.viewed, "viewed", true)
          updateUnseen("project", directory, [])
          sessions.forEach((session) => {
            updateUnseen(
              "session",
              session,
              (index.session.unseen[session] ?? empty).filter((notification) => notification.directory !== directory),
            )
          })
        })
      },
    },
  }
}

const { use: useNotificationService, provider: NotificationServiceProvider } = createSimpleContext({
  name: "NotificationService",
  gate: false,
  init: (props: { href: (server: ServerContext, directory: string, sessionID?: string) => string }) => {
    const global = useGlobal()
    const platform = usePlatform()
    const settings = useSettings()
    const language = useLanguage()
    const owner = getOwner()
    const active: { current?: ActiveNotificationRoute } = {}
    const cache = createScopedCache(
      (current: ServerContext) =>
        (() => {
          const entry = createRoot(
            (dispose) => ({
              value: createNotificationServerState({
                server: current,
                active: () => active.current,
                platform,
                settings,
                language,
                href: props.href,
              }),
              dispose,
            }),
            owner,
          )
          return { ...entry, unregister: current.onDispose(() => cache.delete(current)) }
        })(),
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

    return {
      forServer: (server: ServerContext) => cache.get(server).value,
      activate(route: ActiveNotificationRoute) {
        active.current = route
        return () => {
          if (active.current === route) active.current = undefined
        }
      },
    }
  },
})

export { NotificationServiceProvider }

export const { use: useNotification, provider: NotificationProvider } = createSimpleContext({
  name: "Notification",
  gate: false,
  init: (props: { directory: Accessor<string | undefined>; sessionID: Accessor<string | undefined> }) => {
    const server = useServerContext()
    const service = useNotificationService()
    onCleanup(service.activate({ server, directory: props.directory, sessionID: props.sessionID }))
    const current = createMemo(() => service.forServer(server()))

    return {
      forServer: service.forServer,
      ready: () => current().ready(),
      session: {
        all: (session: string) => current().session.all(session),
        unseen: (session: string) => current().session.unseen(session),
        unseenCount: (session: string) => current().session.unseenCount(session),
        unseenHasError: (session: string) => current().session.unseenHasError(session),
        markViewed: (session: string) => current().session.markViewed(session),
      },
      project: {
        all: (directory: string) => current().project.all(directory),
        unseen: (directory: string) => current().project.unseen(directory),
        unseenCount: (directory: string) => current().project.unseenCount(directory),
        unseenHasError: (directory: string) => current().project.unseenHasError(directory),
        markViewed: (directory: string) => current().project.markViewed(directory),
      },
    }
  },
})
