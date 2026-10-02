import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  getOwner,
  on,
  onCleanup,
  runWithOwner,
  untrack,
  type Accessor,
  type Owner,
} from "solid-js"
import { createStore, produce, type Store } from "solid-js/store"
import { Predicate, type Schema } from "effect"
import { useDialog } from "@opencode/ui/context/dialog"
import { base64Encode } from "@opencode/util/encode"
import {
  Panel,
  type Build,
  type Layout,
  type MountedSession,
  type OpenOptions,
  type PanelSidebar,
  type PanelState,
  type Preferences,
  type ServerRef,
  type SessionRef,
  type Storage,
  type StorageScope,
  type StoreFrom,
  type StoreOptions,
} from "@opencode/gui-extensions/sdk"
import { usePlatform } from "@/runtime/platform/platform"
import { same } from "@/runtime/persistence/equality"
import { Persist, persisted, removePersisted } from "@/runtime/persistence/storage"
import { useGlobal, type ServerCtx } from "@/runtime/server/runtime"
import { ServerConnection, serverName, useServers } from "@/runtime/server/registry"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { SessionRouteKey, SessionStateKey, type ServerScope } from "@/runtime/server/scope"
import { findSessionTab, tabKey, useTabs } from "@/shell/tabs/tabs"
import { useCurrentRoute, useLayout } from "@/shell/state/layout"
import { terminalFontFamily, useSettings } from "@/settings/model"
import { useSettingsSurface } from "@/settings/surface"
import { formatKeybindParts, useCommand } from "@/shell/commands/command"
import { createMediaQuery } from "@solid-primitives/media"
import { useIsRouting, useLocation } from "@solidjs/router"
import { useLanguage } from "@/runtime/i18n/language"
import { createEmbeds } from "./embeds"
import { useExtensionHost, type HostApiFactories } from "./host"
import { createLocatedWrites } from "./located"
import type { Region } from "./panels"
import { persistedHandle } from "./stores"

type Attached = {
  sessions: Accessor<readonly SessionRef[]>
  current: Accessor<MountedSession | undefined>
  scope: (server: string) => ServerScope
  /** Records a session-scoped store so layout pruning drops it with the session. */
  scoped: (name: string) => void
  layout: Omit<Layout, "narrow" | "settings" | "project" | "stored"> & {
    stored(extension: string, session: SessionRef): readonly string[]
  }
  settings: (page?: string) => void
  project: (server: string, title: string) => void
  font: Accessor<string>
  preferences: Preferences
  routing: Accessor<boolean>
  path: Accessor<string>
  keybind: (command: string) => readonly string[]
  matches: (command: string, event: KeyboardEvent) => boolean
  servers: Accessor<readonly string[]>
}

/** What persistence imports a store's older value from. */
type CopyFrom = NonNullable<Exclude<Parameters<typeof persisted>[0], string>["copyFrom"]>

/** HostApis the host owns. Session and layout attach once the app interface mounts. */
export function createHostApis() {
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()
  // The session screen's breakpoint, negated, so no fractional width is both narrow and desktop.
  const desktop = createMediaQuery("(min-width: 768px)")
  const narrow = () => !desktop()
  const [attached, setAttached] = createSignal<Attached>()
  const removed = new Set<(value: { server: string; directory: string }) => void>()
  const memory = new Map<string, ReturnType<Storage["memory"]>>()
  const current = () => attached()

  const embeds = createEmbeds({
    bridge: platform.extensions,
    zoom: () => platform.webviewZoom?.() ?? 1,
    dialog: () => !!dialog.active,
  })

  const target = (extension: string, key: string, scope: StorageScope | undefined, from: StoreFrom | undefined) => {
    const name = `extension.${extension}.${key}`
    const copyFrom = copySpec(from)

    if (!scope || scope === "global") return { ...Persist.global(name), copyFrom }
    const connected = requireAttached(attached())

    if ("session" in scope) {
      const location = scope.session.location

      if (!location) throw new Error("Session storage requires a session location")
      connected.scoped(name)
      const server = connected.scope(scope.session.server.id)
      const directory = base64Encode(location.directory)

      return {
        ...Persist.serverSession(server, directory, scope.session.id, name),
        copyFrom:
          sessionCopy(from, SessionStateKey.from(server, SessionRouteKey.fromRoute(directory, scope.session.id))) ??
          copyFrom,
      }
    }

    if (!scope.directory) return { ...Persist.serverGlobal(connected.scope(scope.server), name), copyFrom }

    return { ...Persist.serverWorkspace(connected.scope(scope.server), base64Encode(scope.directory), name), copyFrom }
  }

  const apis: HostApiFactories = {
    storage: (extension, owner) => ({
      store<S extends Schema.ConstraintCodec<object, unknown>>(key: string, options: StoreOptions<S>) {
        // Persistence owns effects and resources; code after an await in setup has no owner.
        const pair = runWithOwner(getOwner() ?? owner, () =>
          persisted(target(extension, key, options.scope, options.from), options.schema, options.initial, platform),
        )!

        return persistedHandle({
          store: pair[0],
          update: (mutation: (draft: S["Type"]) => void) => pair[1](produce(mutation)),
          init: pair[3].promise,
        })
      },
      memory<T extends object>(key: string, options: { readonly initial: T }) {
        const name = `${extension}.${key}`
        const existing = memory.get(name)

        if (existing) {
          // SAFETY: a memory key is one extension's store, which that extension always opens with the same shape.
          return existing as readonly [Store<T>, (mutation: (draft: T) => void) => void]
        }

        const [store, setStore] = createStore(options.initial)
        const value = [store, (mutation: (draft: T) => void) => setStore(produce(mutation))] as const

        memory.set(name, value)

        return value
      },
      remove(key, options) {
        removePersisted(target(extension, key, options?.scope, undefined), platform)
      },
    }),
    system: () => ({
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
      openExternal(url) {
        if (platform.openLocalFile && URL.canParse(url) && new URL(url).protocol === "file:")
          return platform.openLocalFile(url)
        platform.openExternal(url)
      },
    }),
    desktop: () =>
      platform.platform === "desktop"
        ? {
            os: platform.os ?? "linux",
            window: platform.windowID,
            zoom: () => platform.webviewZoom?.() ?? 1,
            launch: (path, app) => platform.openPath?.(path, app) ?? Promise.resolve(),
            reveal: (path) => platform.revealPath?.(path) ?? Promise.resolve(false),
            installed: (app) => platform.checkAppExists?.(app) ?? Promise.resolve(false),
            forceFocus: (enabled) => platform.setForceFocus?.(enabled) ?? Promise.resolve(),
          }
        : undefined,
    build: () => ({
      version: platform.version ?? "",
      // SAFETY: the build sets VITE_OPENCODE_CHANNEL to one of the release channels, or leaves it unset locally.
      channel: (import.meta.env.VITE_OPENCODE_CHANNEL ?? "local") as Build["channel"],
      platform: platform.platform,
      packaged: platform.extensions?.packaged ?? false,
    }),
    locale: () => ({
      locale: language.intl,
      direction: language.direction,
      setDirection: language.setDirection,
    }),
    appearance: () => ({ font: () => requireAttached(current()).font() }),
    router: () => ({
      routing: () => current()?.routing() ?? false,
      path: () => current()?.path() ?? "",
    }),
    keybinds: () => ({
      keybind: (command) => current()?.keybind(command) ?? [],
      keys: (bind) => formatKeybindParts(bind, language.t),
      matches: (command, event) => current()?.matches(command, event) ?? false,
    }),
    servers: () => ({ list: () => current()?.servers() ?? [] }),
    workspaces: (_extension, _owner, _context, register) => ({
      on(_event, handler) {
        removed.add(handler)

        return register(() => {
          removed.delete(handler)
        })
      },
    }),
    sessions: () => ({
      list: () => current()?.sessions() ?? [],
      current: () => current()?.current(),
    }),
    layout: (extension) => ({
      narrow,
      ready: () => current()?.layout.ready() ?? false,
      open: (key, session, options) => requireAttached(current()).layout.open(key, session, options),
      close: (key, session) => requireAttached(current()).layout.close(key, session),
      toggle: (key, session) => requireAttached(current()).layout.toggle(key, session),
      state: (key, session) => requireAttached(current()).layout.state(key, session),
      stored: (session) => requireAttached(current()).layout.stored(extension, session),
      side: {
        opened: (session) => requireAttached(current()).layout.side.opened(session),
        toggle: (session) => requireAttached(current()).layout.side.toggle(session),
      },
      sidebar: { opened: () => requireAttached(current()).layout.sidebar.opened() },
      dock: {
        opened: (session) => requireAttached(current()).layout.dock.opened(session),
        placement: () => requireAttached(current()).layout.dock.placement(),
      },
      scroll: {
        get: (session, key) => requireAttached(current()).layout.scroll.get(session, key),
        set: (session, key, value) => requireAttached(current()).layout.scroll.set(session, key, value),
      },
      settings: (page) => requireAttached(current()).settings(page),
      project: (server, title) => requireAttached(current()).project(server, title),
    }),
    preferences: () => ({
      releaseNotes: () => requireAttached(current()).preferences.releaseNotes(),
      setReleaseNotes: (value) => requireAttached(current()).preferences.setReleaseNotes(value),
      mobileDiffWrap: () => requireAttached(current()).preferences.mobileDiffWrap(),
    }),
    embeds: () => embeds,
  }

  return {
    apis,
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

export type HostApis = ReturnType<typeof createHostApis>

export { ExtensionAttachmentProvider, useExtensionAttachment } from "./attachment"

/** Attaches the session and layout HostApis from inside the app interface. */
export function createExtensionAttachment(apis: HostApis) {
  const global = useGlobal()
  const tabs = useTabs()
  const layout = useLayout()
  const route = useCurrentRoute()
  const settings = useSettings()
  const surface = useSettingsSurface()
  const host = useExtensionHost()
  const command = useCommand()
  const location = useLocation()
  const desktop = createMediaQuery("(min-width: 768px)")
  const narrow = () => !desktop()
  const mountedSessions = new Map<string, MountedSession>()
  const [mounted, setMounted] = createStore({ revision: 0 })
  const refs = new Map<string, SessionRef>()

  const connection = (id: string) => global.servers.list().find((item) => ServerConnection.key(item) === id)

  // One ref per server id. A restarted server (e.g. an updated WSL server) gets a new controller under the same id,
  // so the ref follows the live controller instead of the one it was created with.
  const owner = getOwner()
  const serverRefs = new Map<string, ServerRef>()

  const server = (id: string): ServerRef | undefined => {
    const conn = connection(id)

    if (!conn) return
    const existing = serverRefs.get(id)

    if (existing) return existing
    const key = ServerConnection.Key.make(id)

    const live = runWithOwner(owner, () =>
      createMemo<ServerCtx>((previous) => global.serverCtx(key) ?? previous, global.ensureServerCtx(conn)),
    )!

    const ref: ServerRef = {
      id,
      get name() {
        return serverName(live().sdk.server) || id
      },
      get url() {
        return live().sdk.url
      },
      get password() {
        return live().sdk.server.http.password
      },
      get client() {
        return live().sdk.api
      },
      get data() {
        return live().data
      },
      get local() {
        return ServerConnection.local(live().sdk.server)
      },
      get builtin() {
        return ServerConnection.builtin(live().sdk.server)
      },
      get compatible() {
        return !global.servers.health[key]?.incompatible
      },
      get connected() {
        return live().sdk.connection.status() === "connected"
      },
    }

    serverRefs.set(id, ref)

    return ref
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

  const routed = createMemo(() => {
    const value = route()

    return value.type === "session" ? `${value.server}\n${value.sessionId}` : undefined
  })

  const current = createMemo(() => {
    const key = routed()

    if (!key) return
    void mounted.revision

    return mountedSessions.get(key)
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

  const sideOpened = (session: SessionRef) => !!tabs.region(shellTab(session), "side")
  const dockOpened = (session: SessionRef) => !!tabs.region(shellTab(session), "dock")
  const setDock = (session: SessionRef, opened: boolean) => tabs.setRegion(shellTab(session), "dock", opened)

  // A token per session whose side region is open, new each time the region opens.
  const sideVisits = createMemo<ReadonlyMap<string, object>>(
    (previous) =>
      new Map(
        sessions().flatMap((session) =>
          sideOpened(session) ? [[session.key, previous.get(session.key) ?? {}] as const] : [],
        ),
      ),
    new Map(),
  )

  // The panel whose toggle opened a side region, by the region's token. However the region closes, it reopens with
  // a new token, so a region reopened any other way belongs to the user.
  const openedFor = new WeakMap<object, string>()

  // Keys are `${extension}:${tab id}`; the extension's panel decides the region.
  const provider = (key: string) => {
    const extension = key.slice(0, key.indexOf(":"))
    const matches = host.items(Panel).filter((item) => item.extension === extension)

    return matches.find((item) => item.value.region === "side") ?? matches[0]
  }

  const mountedSession = (session: SessionRef) => {
    const view = current()

    return view?.key === session.key ? view : undefined
  }

  // Counts routing visits: each change of the routed session, including to none (e.g. Home), starts the next one.
  const visit = createMemo(on(routed, (_key, _previous, count: number = 0) => count + 1))
  // `MountedSession.visit`: a new object for each routing visit.
  const token = createMemo(on(visit, () => ({})))

  // The narrow-screen view belongs to the routed, mounted session for one visit, and reads as the conversation once
  // another visit starts. A view selected for a session that is not routed (e.g. a file link that opens Files on
  // another session) belongs to the next visit, which the navigation that follows starts. The dock's view follows
  // the dock's own per-session state instead.
  const [mobile, setMobile] = createStore<{ session: string | undefined; view: string; visit: number }>({
    session: undefined,
    view: "session",
    visit: 0,
  })

  const mobileView = createMemo(() =>
    mobile.session === current()?.key && mobile.visit === visit() ? mobile.view : "session",
  )

  const selectMobile = (session: SessionRef, view: string) =>
    setMobile({ session: session.key, view, visit: session.key === routed() ? visit() : visit() + 1 })

  // The side tabs a mounted session lists right now, plus `adding` as if it were stored; unmounted sessions have none.
  const listed = (session: SessionRef, value: string, adding?: string) => {
    const view = mountedSession(session)

    if (!view) return []
    const all = layout.panel.state(value).all
    const stored = adding && !all.includes(adding) ? [...all, adding] : all

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

  // Writes made before a session's location is known wait for it rather than being dropped.
  const located = createLocatedWrites()

  const open = (key: string, session: SessionRef, options?: OpenOptions) => {
    const item = provider(key)

    if (item?.value.region === "dock") return setDock(session, true)
    const value = stateKey(session)

    if (!value) return located.hold(session, () => open(key, session, options))
    const placement = options?.tab ?? "open"

    // An append adds the tab quietly: no selection, no region change, no preview replacement.
    if (placement === "append") return layout.panel.append(value, key)

    // A select keeps the narrow-screen view and dock, as a background open does, and opens the side region too.
    if (placement === "select")
      return batch(() => {
        tabs.setRegion(shellTab(session), "side", true)
        layout.panel.append(value, key)
        layout.panel.focus(value, key)
      })
    // Lists the opened tab too, so its own fields apply before it is stored. A hover-closable tab is a launcher.
    const known = listed(session, value, key)
    const launchers = new Set(known.flatMap((entry) => (entry.tab.closable === "hover" ? [entry.key] : [])))
    const first = known.some((entry) => entry.key === key && entry.tab.first)
    batch(() => {
      if (narrow() && !options?.background) {
        setDock(session, false)

        if (item?.value.mobile) selectMobile(session, `${item.extension}:${item.value.id}`)

        // A tab its panel does not list, or a launcher, stays unstored: the open only selects the panel's view.
        if (mountedSession(session) && !known.some((entry) => entry.key === key && entry.tab.closable !== "hover"))
          return
      }

      // A background open keeps the narrow-screen view, but its tab still shows once the window is wide.
      if (!narrow() || options?.background) tabs.setRegion(shellTab(session), "side", true)

      // Pinned tabs are listed without being stored; opening one only selects it.
      if (known.some((entry) => entry.key === key && entry.tab.pinned)) return layout.panel.focus(value, key)

      if (placement === "preview") return layout.panel.preview(value, key, launchers)
      layout.panel.open(value, key, launchers, first)
    })
  }

  const close = (key: string, session: SessionRef) => {
    const item = provider(key)

    if (item?.value.region === "dock") return setDock(session, false)
    const value = stateKey(session)

    if (!value) return located.hold(session, () => close(key, session))
    const tab = listed(session, value).find((entry) => entry.key === key)?.tab
    layout.panel.close(value, key)
    const view = mountedSession(session)

    if (view && tab) item?.value.close?.(tab, view)
  }

  // The routed session's side region, which knows the fallback selection the stored state lacks.
  const [region, setRegion] = createSignal<Region>()
  // The session screen's inner sidebar preference, which its side panels share.
  const [sidebar, setSidebar] = createSignal<PanelSidebar>()

  const opened = createMemo(
    () => Array.from(new Set((region()?.entries() ?? []).flatMap((entry) => entry.tab.file ?? []))),
    [],
    { equals: same },
  )

  const state = (key: string, session: SessionRef): PanelState => {
    if (provider(key)?.value.region === "dock") return dockOpened(session) ? "visible" : "closed"
    const value = stateKey(session)

    if (!value) return "closed"
    const panel = layout.panel.state(value)
    const active = mountedSession(session) ? (region()?.active() ?? panel.active) : panel.active

    if (active !== key) return panel.all.includes(key) ? "open" : "closed"

    return sideOpened(session) ? "visible" : "active"
  }

  // Open-project requests wait until their server is listed (e.g. an SSH server that just connected).
  const servers = useServers()
  const picker = useDirectoryPicker()
  const [projects, setProjects] = createSignal<readonly { server: string; title: string }[]>([])
  createEffect(() => {
    const pending = projects()

    const ready = pending.flatMap((request) => {
      const server = servers.list.find((conn) => ServerConnection.key(conn) === request.server)

      return server ? [{ request, server }] : []
    })

    if (ready.length === 0) return
    setProjects(pending.filter((request) => !ready.some((item) => item.request === request)))
    untrack(() =>
      ready.forEach(({ request, server }) =>
        picker({
          server,
          title: request.title,
          onSelect: (value) => {
            const directory = Array.isArray(value) ? value[0] : value

            if (!directory) return
            const key = ServerConnection.key(server)
            servers.projects.forServer(key).open(directory)
            void tabs.newDraft({ server: key, directory })
          },
        }),
      ),
    )
  })

  const toggle = (key: string, session: SessionRef) => {
    if (provider(key)?.value.region === "dock") return setDock(session, !dockOpened(session))
    const value = stateKey(session)

    if (!value) return located.hold(session, () => toggle(key, session))
    const region = sideVisits().get(session.key)

    if (state(key, session) === "visible") {
      batch(() => {
        close(key, session)

        // Closing the last panel the region was opened for also closes the region.
        if (region && openedFor.get(region) === key && layout.panel.state(value).all.length === 0)
          tabs.setRegion(shellTab(session), "side", false)
      })

      return
    }

    // A panel opened into an open region makes the region the user's.
    if (region) openedFor.delete(region)
    open(key, session)
    const opened = sideVisits().get(session.key)

    if (!region && opened) openedFor.set(opened, key)
  }

  const setScroll = (session: SessionRef, key: string, next: { readonly x: number; readonly y: number }) => {
    const value = stateKey(session)

    if (!value) return located.hold(session, () => setScroll(session, key, next))
    layout.panel.setScroll(value, key, next)
  }

  const detach = apis.attach({
    sessions,
    current,
    scope,
    scoped: layout.sessionState.track,
    project: (server, title) => setProjects((pending) => [...pending, { server, title }]),
    font: () => terminalFontFamily(settings.appearance.terminalFont()),
    routing: useIsRouting(),
    path: () => `${location.pathname}${location.search}`,
    keybind: command.keybindParts,
    matches: command.matches,
    servers: () => global.servers.list().map(ServerConnection.key),
    preferences: {
      releaseNotes: settings.general.releaseNotes,
      setReleaseNotes: settings.general.setReleaseNotes,
      mobileDiffWrap: settings.general.mobileDiffWrap,
    },
    // SAFETY: an extension names a page it contributed through `SettingsPage`, which settings lists as an extension tab.
    settings: (page) => surface.open(page as Parameters<typeof surface.open>[0]),
    layout: {
      ready: layout.ready,
      open,
      close,
      toggle,
      state,
      stored(extension, session) {
        const value = stateKey(session)

        if (!value) return []
        const prefix = `${extension}:`

        return layout.panel
          .state(value)
          .all.flatMap((key) => (key.startsWith(prefix) ? [key.slice(prefix.length)] : []))
      },
      side: {
        opened: sideOpened,
        toggle: (session) => tabs.setRegion(shellTab(session), "side", !sideOpened(session)),
      },
      // Open is the stored preference's default, which holds until a session screen shows the preference.
      sidebar: { opened: () => sidebar()?.opened() ?? true },
      dock: {
        opened: dockOpened,
        placement: settings.general.terminalPlacement,
      },
      scroll: {
        get(session, key) {
          const value = stateKey(session)

          return value ? layout.panel.scroll(value, key) : undefined
        },
        set: setScroll,
      },
    },
  })

  onCleanup(detach)

  return {
    /** The routed `MountedSession`. */
    current,
    region(value: Region) {
      setRegion(() => value)

      return () => {
        if (region() === value) setRegion(undefined)
      }
    },
    /** The session screen's inner sidebar preference, which `Layout.sidebar` reads. */
    sidebar(value: PanelSidebar) {
      setSidebar(() => value)

      return () => {
        if (sidebar() === value) setSidebar(undefined)
      }
    },
    /** Workspace files the routed session's side tabs show, in strip order, and the selected one. */
    files: {
      opened,
      active: () => region()?.selected()?.tab.file,
    },
    mobile: {
      current: mobileView,
      select(view: string) {
        const session = current()

        if (session) selectMobile(session, view)
      },
    },
    /** The current routing visit, which `MountedSession.visit` returns. */
    visit: token,
    mount(key: string, view: MountedSession) {
      mountedSessions.set(key, view)
      setMounted("revision", (value) => value + 1)
      // The session's declared stores start loading now, before its regions read them.
      untrack(() => host.preload(view))

      return () => {
        if (mountedSessions.get(key) !== view) return
        mountedSessions.delete(key)
        setMounted("revision", (value) => value + 1)
      }
    },
  }
}

function requireAttached(value: Attached | undefined) {
  if (!value) throw new Error("The app interface is not mounted")

  return value
}

/** A store's `from` in the object form persistence takes. */
function copySpec(from: StoreFrom | undefined) {
  // SAFETY: `StoreFrom` is an older key alone or an object with a key and a pick, as the SDK types it.
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- see SAFETY above
  return typeof from === "string" ? { key: from } : from
}

/** Imports a session's entry from an app key that holds every session's state under one field. */
function sessionCopy(from: StoreFrom | undefined, session: SessionStateKey): CopyFrom | undefined {
  const spec = copySpec(from)

  if (!spec || !("sessions" in spec) || !spec.sessions) return

  const field = spec.sessions

  return {
    key: spec.key,
    storage: Persist.global(spec.key).storage,
    pick: (value) => {
      const sessions = Predicate.isObject(value) ? value[field] : undefined

      return spec.pick(Predicate.isObject(sessions) ? sessions[session] : undefined)
    },
  }
}
