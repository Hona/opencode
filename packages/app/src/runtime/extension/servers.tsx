import { createContext, createMemo, createSignal, useContext, type ParentProps } from "solid-js"
import { Menu, Server, type ServerEntry } from "@opencode/gui-extensions/sdk"
import type { ServerConnection } from "@/runtime/server/registry"
import { useExtensionHost } from "./host"

/** A server an extension contributes. `key` is `${extension}:${entry.id}`. */
export type ExtensionServer = { readonly key: string; readonly extension: string; readonly entry: ServerEntry }

// Endpoint of a contributed server before its extension reports one.
const offline = { url: "http://127.0.0.1:0" }

const ServersContext = createContext<ReturnType<typeof createExtensionServers>>()

export function useExtensionServers() {
  const value = useContext(ServersContext)
  if (!value) throw new Error("Extension servers are unavailable")
  return value
}

/** Collects Server contributions. `failed` reports extensions whose main entry failed, so startup stops waiting for them. */
export function ExtensionServersProvider(props: ParentProps<{ failed: (extension: string) => boolean }>) {
  return (
    <ServersContext.Provider value={createExtensionServers(props.failed)}>{props.children}</ServersContext.Provider>
  )
}

function createExtensionServers(failed: (extension: string) => boolean) {
  const host = useExtensionHost()
  const sources = createMemo(() => host.items(Server).toSorted((a, b) => (a.value.order ?? 0) - (b.value.order ?? 0)))
  const entries = createMemo(() =>
    sources().flatMap((item) =>
      item.value.entries.map(
        (entry): ExtensionServer => ({ key: `${item.extension}:${entry.id}`, extension: item.extension, entry }),
      ),
    ),
  )
  // Routes key on the connection object. Keep one per key across entry updates so reconnecting
  // never unmounts an open conversation or composer.
  const connections = new Map<
    string,
    { update: (server: ExtensionServer) => void; value: ServerConnection.Extension }
  >()
  const list = createMemo(() => {
    const listed = entries().filter((item) => item.entry.listed !== false)
    const keys = new Set(listed.map((item) => item.key))
    connections.forEach((_, key) => {
      if (!keys.has(key)) connections.delete(key)
    })
    return listed.map((item) => {
      const existing = connections.get(item.key)
      if (existing) {
        existing.update(item)
        return existing.value
      }
      const created = connection(item)
      connections.set(item.key, created)
      return created.value
    })
  })
  // Startup waits for every source once; a source that reloads later does not hide the app again.
  const ready = createMemo<boolean>(
    (previous) => previous || (host.ready() && sources().every((item) => item.value.ready || failed(item.extension))),
    false,
  )
  return {
    ready,
    /** Contributed servers the app lists, as stable connections. */
    list,
    /** Every contributed server, including those settings lists before they are ready. */
    entries,
    entry: (key: string) => entries().find((item) => item.key === key),
  }
}

function connection(initial: ExtensionServer) {
  const [current, setCurrent] = createSignal(initial)
  const entry = () => current().entry
  const value: ServerConnection.Extension = {
    type: "extension",
    key: initial.key,
    extension: initial.extension,
    get displayName() {
      return entry().name
    },
    get label() {
      return entry().label
    },
    get state() {
      return entry().state
    },
    get connecting() {
      return entry().state === "starting"
    },
    get authenticationRequired() {
      return entry().state === "auth"
    },
    get managed() {
      return !!entry().reconnect
    },
    get http() {
      return entry().http ?? offline
    },
    get reconnect() {
      const reconnect = entry().reconnect
      return reconnect ? (signal: AbortSignal) => reconnect(signal) : undefined
    },
    connect: () => entry().connect?.() ?? Promise.resolve(entry().state === "ready"),
  }
  return { update: (server: ExtensionServer) => setCurrent(server), value }
}

/** Menu "server.row" items that apply to a server. */
export function useServerRowItems(server: () => string) {
  const host = useExtensionHost()
  return createMemo(() =>
    host
      .items(Menu)
      .filter((item) => item.value.menu === "server.row" && (item.value.when?.(server()) ?? true))
      .toSorted((a, b) => (a.value.order ?? 0) - (b.value.order ?? 0))
      .map((item) => item.value),
  )
}

/** Menu "server.add" items, in order. */
export function useServerAddItems() {
  const host = useExtensionHost()
  return createMemo(() =>
    host
      .items(Menu)
      .filter((item) => item.value.menu === "server.add")
      .toSorted((a, b) => (a.value.order ?? 0) - (b.value.order ?? 0))
      .map((item) => item.value),
  )
}
