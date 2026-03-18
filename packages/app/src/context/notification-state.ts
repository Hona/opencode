import { pathKey } from "@opencode-ai/util/path"
import { EventSessionError } from "@opencode-ai/sdk/v2"

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

export type NotificationIndex = {
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

export const projectKey = (directory: string) => pathKey(directory) || directory

export function normalizeNotification(notification: Notification): Notification {
  if (!notification.directory) return notification
  const directory = projectKey(notification.directory)
  if (directory === notification.directory) return notification
  return { ...notification, directory }
}

export function migrateNotifications(value: unknown) {
  if (!value || typeof value !== "object") return { list: [] as Notification[] }
  const list = Array.isArray((value as { list?: unknown }).list) ? (value as { list: Notification[] }).list : []
  return { list: list.map(normalizeNotification) }
}

export function buildNotificationIndex(list: Notification[]) {
  const index = createNotificationIndex()

  list.forEach((item) => {
    const notification = normalizeNotification(item)
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
      const key = projectKey(notification.directory)
      const all = index.project.all[key] ?? []
      index.project.all[key] = [...all, notification]
      if (!notification.viewed) {
        const unseen = index.project.unseen[key] ?? []
        index.project.unseen[key] = [...unseen, notification]
        index.project.unseenCount[key] = unseen.length + 1
        if (notification.type === "error") index.project.unseenHasError[key] = true
      }
    }
  })

  return index
}
