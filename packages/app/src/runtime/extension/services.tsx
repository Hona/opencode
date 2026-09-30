import { batch, createContext, createMemo, createSignal, onCleanup, untrack, useContext, type Accessor } from "solid-js"
import { createStore, produce, type Store } from "solid-js/store"
import { useDialog } from "@opencode/ui/context/dialog"
import { base64Encode } from "@opencode/util/encode"
import {
  App,
  Dialogs,
  Layout,
  Native,
  Panel,
  Sessions,
  Storage,
  System,
  type Host,
  type PanelState,
  type ServerRef,
  type SessionRef,
  type SessionView,
  type StorageScope,
} from "@opencode/gui-extensions/sdk"
import { usePlatform } from "@/runtime/platform/platform"
import { Persist, persisted, removePersisted } from "@/runtime/persistence/storage"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { SessionRouteKey, SessionStateKey, type ServerScope } from "@/runtime/server/scope"
import { findSessionTab, tabKey, useTabs } from "@/shell/tabs/tabs"
import { useCurrentRoute, useLayout } from "@/shell/state/layout"
import { terminalFontFamily, useSettings } from "@/settings/model"
import { useSettingsSurface } from "@/settings/surface"
import { createMediaQuery } from "@solid-primitives/media"
import { useExtensionHost } from "./host"

type Attached = {
  sessions: Accessor<readonly SessionRef[]>
  current: Accessor<SessionView | undefined>
  scope: (server: string) => ServerScope
  layout: Omit<Layout, "narrow" | "settings">
  settings: (page?: string) => void
  font: Accessor<string>
}

export type HostService = { readonly token: Host<unknown>; create(extension: string): unknown }
type StorageFrom = Parameters<Storage["store"]>[1]["from"]

/** Services the host owns. Session and layout attach once the app interface mounts. */
export function createExtensionServices() {
  const platform = usePlatform()
  const dialog = useDialog()
  const narrow = createMediaQuery("(max-width: 767px)")
  const [attached, setAttached] = createSignal<Attached>()
  const removed = new Set<(value: { server: string; directory: string }) => void>()
  const memory = new Map<string, readonly [Store<object>, (mutation: (draft: object) => void) => void]>()
  const current = () => attached()

  const target = (extension: string, key: string, scope: StorageScope | undefined, from: StorageFrom | undefined) => {
    const name = `extension.${extension}.${key}`
    const copyFrom = typeof from === "string" ? { key: from } : from
    if (!scope || scope === "app") return { ...Persist.global(name), copyFrom }
    const connected = requireAttached(attached())
    if ("session" in scope) {
      const location = scope.session.location
      if (!location) throw new Error("Session storage requires a session location")
      return {
        ...Persist.serverSession(
          connected.scope(scope.session.server.id),
          base64Encode(location.directory),
          scope.session.id,
          name,
        ),
        copyFrom,
      }
    }
    if (!scope.directory) return { ...Persist.serverGlobal(connected.scope(scope.server), name), copyFrom }
    return { ...Persist.serverWorkspace(connected.scope(scope.server), base64Encode(scope.directory), name), copyFrom }
  }

  const services: HostService[] = [
    {
      token: Storage,
      create: (extension) =>
        ({
          store(key, options) {
            const pair = persisted(target(extension, key, options.scope, options.from), options.schema, options.initial, platform)
            return [pair[0], (mutation: (draft: object) => void) => pair[1](produce(mutation)), pair[3]] as never
          },
          memory(key, options) {
            const name = `${extension}.${key}`
            const existing = memory.get(name)
            if (existing) return existing as never
            const [store, setStore] = createStore<object>(options.initial)
            const value = [store, (mutation: (draft: object) => void) => setStore(produce(mutation))] as const
            memory.set(name, value)
            return value as never
          },
          remove(key, options) {
            removePersisted(target(extension, key, options?.scope, undefined), platform)
          },
        }) satisfies Storage,
    },
    {
      token: System,
      create: () =>
        ({
          copy: (text) => platform.writeClipboardText?.(text) ?? navigator.clipboard.writeText(text),
          async save(file) {
            if (platform.saveFile) return platform.saveFile({ defaultPath: file.name }, file.content)
            const url = URL.createObjectURL(new Blob([file.content], { type: "application/octet-stream" }))
            const link = document.createElement("a")
            link.href = url
            link.download = file.name
            link.click()
            URL.revokeObjectURL(url)
            return true
          },
          open: (url) => platform.openExternal(url),
        }) satisfies System,
    },
    {
      token: Native,
      create: () =>
        platform.platform === "desktop"
          ? ({
              os: platform.os ?? "linux",
              window: platform.windowID,
              zoom: () => platform.webviewZoom?.() ?? 1,
              launch: (path, app) => platform.openPath?.(path, app) ?? Promise.resolve(),
              reveal: (path) => platform.revealPath?.(path) ?? Promise.resolve(false),
              installed: (app) => platform.checkAppExists?.(app) ?? Promise.resolve(false),
            } satisfies NonNullable<Native>)
          : undefined,
    },
    {
      token: App,
      create: () =>
        ({
          version: platform.version,
          channel: (import.meta.env.VITE_OPENCODE_CHANNEL ?? "local") as App["channel"],
          platform: platform.platform,
          font: () => requireAttached(current()).font(),
          on(_event, handler) {
            removed.add(handler)
            return () => {
              removed.delete(handler)
            }
          },
        }) satisfies App,
    },
    {
      token: Dialogs,
      create: () =>
        ({
          show: (render) => dialog.show(render),
          close: () => dialog.close(),
        }) satisfies Dialogs,
    },
    {
      token: Sessions,
      create: () =>
        ({
          list: () => current()?.sessions() ?? [],
          current: () => current()?.current(),
        }) satisfies Sessions,
    },
    {
      token: Layout,
      create: () =>
        ({
          narrow,
          open: (key, session, options) => requireAttached(current()).layout.open(key, session, options),
          close: (key, session) => requireAttached(current()).layout.close(key, session),
          toggle: (key, session) => requireAttached(current()).layout.toggle(key, session),
          state: (key, session) => requireAttached(current()).layout.state(key, session),
          side: {
            opened: (session) => requireAttached(current()).layout.side.opened(session),
            toggle: (session) => requireAttached(current()).layout.side.toggle(session),
          },
          dock: {
            opened: (session) => requireAttached(current()).layout.dock.opened(session),
            placement: () => requireAttached(current()).layout.dock.placement(),
          },
          scroll: {
            get: (session, key) => requireAttached(current()).layout.scroll.get(session, key),
            set: (session, key, value) => requireAttached(current()).layout.scroll.set(session, key, value),
          },
          settings: (page) => requireAttached(current()).settings(page),
        }) satisfies Layout,
    },
  ]

  return {
    services,
    attach(value: Attached) {
      setAttached(() => value)
      return () => {
        if (attached() === value) setAttached(undefined)
      }
    },
    workspaceRemoved(value: { server: string; directory: string }) {
      removed.forEach((handler) => handler(value))
    },
  }
}

export type ExtensionServices = ReturnType<typeof createExtensionServices>

const AttachmentContext = createContext<ReturnType<typeof createExtensionAttachment>>()

export function useExtensionAttachment() {
  const value = useContext(AttachmentContext)
  if (!value) throw new Error("Extension attachment is unavailable")
  return value
}

export const ExtensionAttachmentProvider = AttachmentContext.Provider

/** Attaches session and layout services from inside the app interface. */
export function createExtensionAttachment(services: ExtensionServices) {
  const global = useGlobal()
  const tabs = useTabs()
  const layout = useLayout()
  const route = useCurrentRoute()
  const settings = useSettings()
  const surface = useSettingsSurface()
  const host = useExtensionHost()
  const narrow = createMediaQuery("(max-width: 767px)")
  const views = new Map<string, SessionView>()
  const [mounted, setMounted] = createStore({ revision: 0 })
  const refs = new Map<string, SessionRef>()
  const openedFor = new Map<string, string>()

  const connection = (id: string) => global.servers.list().find((item) => ServerConnection.key(item) === id)

  const server = (id: string): ServerRef | undefined => {
    const conn = connection(id)
    if (!conn) return
    const ctx = global.ensureServerCtx(conn)
    return {
      id,
      get url() {
        return ctx.sdk.url
      },
      password: conn.http.password,
      get client() {
        return ctx.sdk.api
      },
      data: ctx.data,
      local: ServerConnection.local(conn),
      builtin: ServerConnection.builtin(conn),
      get compatible() {
        return !global.servers.health[ServerConnection.Key.make(id)]?.incompatible
      },
    }
  }

  const sessions = createMemo(() => {
    const owned = new Set(tabs.store.filter((tab) => tab.type === "session").map(tabKey))
    Array.from(refs).forEach(([key, ref]) => {
      if (!owned.has(ref.tab)) refs.delete(key)
    })
    tabs.store.forEach((tab) => {
      if (tab.type !== "session") return
      const target = server(tab.server)
      if (!target) return
      Array.from(new Set([tab.sessionId, tab.routeSessionId ?? tab.sessionId])).forEach((id) => {
        const key = `${tab.server}\n${id}`
        if (refs.has(key)) return
        refs.set(key, {
          key,
          id,
          tab: tabKey(tab),
          server: target,
          get pending() {
            return target.data.session.creating(id)
          },
          get location() {
            return target.data.session.get(id)?.location
          },
        })
      })
    })
    return Array.from(refs.values())
  })

  const current = createMemo(() => {
    const value = route()
    if (value.type !== "session") return
    void mounted.revision
    return views.get(`${value.server}\n${value.sessionId}`)
  })

  const scope = (id: string) => {
    const conn = connection(id)
    if (!conn) throw new Error(`Server ${id} is unavailable`)
    return global.ensureServerCtx(conn).sdk.scope
  }

  const stateKey = (session: SessionRef) => {
    const location = session.location
    if (!location) return
    return SessionStateKey.from(
      scope(session.server.id),
      SessionRouteKey.fromRoute(base64Encode(location.directory), session.id),
    )
  }

  const shellTab = (session: SessionRef) =>
    findSessionTab(tabs.store, ServerConnection.Key.make(session.server.id), session.id)
  const sideOpened = (session: SessionRef) => !!tabs.pane(shellTab(session), "review")
  const dockOpened = (session: SessionRef) => !!tabs.pane(shellTab(session), "terminal")
  const setDock = (session: SessionRef, opened: boolean) => tabs.setPane(shellTab(session), "terminal", opened)

  // Keys are `${extension}:${tab id}`; the extension's panel decides the region.
  const provider = (key: string) => {
    const extension = key.slice(0, key.indexOf(":"))
    const matches = host.items(Panel).filter((item) => item.extension === extension)
    return matches.find((item) => item.value.region === "side") ?? matches[0]
  }
  const mountedView = (session: SessionRef) => {
    const view = current()
    return view?.key === session.key ? view : undefined
  }

  // The narrow-screen view resets to the conversation whenever the routed session changes.
  const [mobile, setMobile] = createStore({ session: undefined as string | undefined, view: "session" })
  const mobileView = createMemo(() => (mobile.session === current()?.key ? mobile.view : "session"))
  const selectMobile = (session: SessionRef, view: string) => setMobile({ session: session.key, view })

  // The side tabs a mounted session lists right now; unmounted sessions have none to inspect.
  const listed = (session: SessionRef, value: string) => {
    const view = mountedView(session)
    if (!view) return []
    const stored = layout.panel.state(value).all
    return untrack(() =>
      host
        .items(Panel)
        .filter((item) => item.value.region === "side")
        .flatMap((item) => {
          const prefix = `${item.extension}:`
          const open = stored.flatMap((key) => (key.startsWith(prefix) ? [key.slice(prefix.length)] : []))
          return item.value.list(view, open).map((tab) => ({ key: `${prefix}${tab.id}`, tab }))
        }),
    )
  }

  const open = (key: string, session: SessionRef, options?: { readonly preview?: boolean; readonly focus?: boolean }) => {
    const item = provider(key)
    if (item?.value.region === "dock") return setDock(session, true)
    const value = stateKey(session)
    if (!value) return
    const known = listed(session, value)
    const launchers = new Set(known.flatMap((entry) => (entry.tab.kind === "launcher" ? [entry.key] : [])))
    batch(() => {
      if (narrow()) {
        setDock(session, false)
        if (item?.value.mobile) selectMobile(session, `${item.extension}:${item.value.id}`)
      }
      if (!narrow()) tabs.setPane(shellTab(session), "review", true)
      // Pinned tabs are listed without being stored; opening one only selects it.
      if (known.some((entry) => entry.key === key && entry.tab.kind === "pinned")) return layout.panel.focus(value, key)
      if (options?.preview) return layout.panel.preview(value, key, launchers)
      layout.panel.open(value, key, launchers)
      if (options?.focus !== false) layout.panel.focus(value, key)
    })
  }

  const close = (key: string, session: SessionRef) => {
    const item = provider(key)
    if (item?.value.region === "dock") return setDock(session, false)
    const value = stateKey(session)
    if (!value) return
    const tab = listed(session, value).find((entry) => entry.key === key)?.tab
    layout.panel.close(value, key)
    const view = mountedView(session)
    if (view && tab) item?.value.close?.(tab, view)
  }

  const state = (key: string, session: SessionRef): PanelState => {
    if (provider(key)?.value.region === "dock") return dockOpened(session) ? "visible" : "closed"
    const value = stateKey(session)
    if (!value) return "closed"
    const panel = layout.panel.state(value)
    if (panel.active !== key) return panel.all.includes(key) ? "open" : "closed"
    return sideOpened(session) ? "visible" : "active"
  }

  const detach = services.attach({
    sessions,
    current,
    scope,
    font: () => terminalFontFamily(settings.appearance.terminalFont()),
    settings: (page) => surface.open(page as Parameters<typeof surface.open>[0]),
    layout: {
      open,
      close,
      toggle(key, session) {
        if (provider(key)?.value.region === "dock") return setDock(session, !dockOpened(session))
        const value = stateKey(session)
        if (!value) return
        if (state(key, session) === "visible") {
          batch(() => {
            close(key, session)
            // Closing the last panel the region was opened for also closes the region.
            if (openedFor.get(value) === key && layout.panel.state(value).all.length === 0)
              tabs.setPane(shellTab(session), "review", false)
          })
          return
        }
        if (sideOpened(session)) openedFor.delete(value)
        if (!sideOpened(session)) openedFor.set(value, key)
        open(key, session)
      },
      state,
      side: {
        opened: sideOpened,
        toggle: (session) => tabs.setPane(shellTab(session), "review", !sideOpened(session)),
      },
      dock: {
        opened: dockOpened,
        placement: settings.general.terminalPlacement,
      },
      scroll: {
        get(session, key) {
          const value = stateKey(session)
          return value ? layout.panel.scroll(value, key) : undefined
        },
        set(session, key, next) {
          const value = stateKey(session)
          if (value) layout.panel.setScroll(value, key, next)
        },
      },
    },
  })
  onCleanup(detach)

  return {
    /** The routed, mounted session view. */
    current,
    mobile: {
      current: mobileView,
      select(view: string) {
        const session = current()
        if (session) selectMobile(session, view)
      },
    },
    mount(key: string, view: SessionView) {
      views.set(key, view)
      setMounted("revision", (value) => value + 1)
      return () => {
        if (views.get(key) !== view) return
        views.delete(key)
        setMounted("revision", (value) => value + 1)
      }
    },
  }
}

function requireAttached(value: Attached | undefined) {
  if (!value) throw new Error("The app interface is not mounted")
  return value
}
