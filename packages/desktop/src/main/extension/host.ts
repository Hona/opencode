import { app, BrowserWindow } from "electron"
import { builtins } from "@opencode/gui-extensions/main"
import type { BridgeLayout, BridgeMenubarItem } from "@opencode/gui-extensions/sdk/bridge"
import {
  Cli,
  MainApp,
  MainStorage,
  Menubar,
  Surfaces,
  Windows,
  type Caller,
  type Catalog,
  type Cleanup,
  type Host,
  type MainContext,
  type MainServer,
  type Messages,
  type OS,
  type Params,
  type Point,
  type Provided,
  type Remote,
  type RemoteClient,
  type RemoteImpl,
  type RemoteSpec,
  type Service,
  type Setup,
} from "@opencode/gui-extensions/sdk/main"
import { Exit, Match, Predicate, Schema } from "effect"
import type { Accessor } from "solid-js"
import type { ExtensionEndpoint, ExtensionInstalled } from "../../shared/ipc-rpc/extensions"
import {
  ExtensionAvailable,
  ExtensionEvent,
  ExtensionMenubarChanged,
  ExtensionState,
  ExtensionsChanged,
  type DesktopEvent,
} from "../../shared/ipc-rpc/events"
import { CHANNEL, VERSION } from "../constants"
import { emitIpcEvent } from "../ipc-events"
import { refreshMenu, setMenubarProvider } from "../native/menu"
import {
  formatNativeTemplate,
  nativeLocale,
  nativeMessage,
  nativePluralCategory,
  onNativeTranslations,
} from "../native/translations"
import { SidecarCredentials } from "../service/sidecar-credentials"
import type { Database } from "../storage/database"
import type { StateStore } from "../storage/state"
import { getLastFocusedWindow, getMainWindows, onMainWindow } from "../windows"
import { ExtensionError } from "./error"
import { createLifecycle, type Instance, type Log, type Revision } from "./lifecycle"
import { createManager } from "./manager"
import { evaluateMain } from "./module"
import { createMainStorage, namespace } from "./storage"
import { createSurfaces } from "./surfaces"

export type ExtensionHost = ReturnType<typeof createHost>

type Loaded = { readonly setup: Setup; readonly i18n?: Catalog }

/** A remote method with its spec erased: remotes of every spec share one table, and `call` runs the spec's codecs. */
type Method = RemoteImpl<RemoteSpec>[string]

/** A value one of a remote's schemas governs, erased like the methods that take it. */
type Value = Parameters<Method>[0]

type Provider = {
  readonly extension: string
  readonly signal: AbortSignal
  readonly spec: RemoteSpec
  readonly methods: ReadonlyMap<string, Method>
  readonly state?: (window: number) => Value
  readonly listeners: Set<(name: string, data: Value) => void>
}

/** A contribution as `add` stores it, with its point's item type erased; `list` restores it. */
type Item = Parameters<MainContext["add"]>[1]

type Entry = { readonly point: string; readonly extension: string; readonly value: Item }

type Translation = { readonly catalog?: Catalog; messages: Messages }

const os = Match.value(process.platform).pipe(
  Match.when("darwin", () => "macos" as const),
  Match.when("win32", () => "windows" as const),
  Match.orElse(() => "linux" as const),
) satisfies OS

/**
 * The main-process GUI extension host. Every main extension is an app-scoped singleton; windows
 * reach its remotes over the bridge and main scopes state and events by `caller.window`.
 */
export function createHost(input: {
  readonly db: Database
  readonly state: StateStore
  readonly cli: Cli
  /** Windows per remote that asked for state; shared with the IPC layer, which records them first. */
  readonly subscriptions: Map<string, Set<number>>
  /** The server endpoints each window last pushed. */
  readonly servers: Map<number, readonly ExtensionEndpoint[]>
  readonly restart: (handoff?: () => void | Promise<void>) => Promise<void>
  readonly log: Log
  /** Extension logs at their own level. */
  readonly write: <Data extends Readonly<Record<string, unknown>>>(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    data: Data,
  ) => void
}) {
  const local = builtins.filter((definition) => !definition.os || definition.os.includes(os))

  const manager = createManager(
    input.db,
    (id) => id.startsWith("opencode") || builtins.some((definition) => definition.id === id),
  )

  const surfaces = createSurfaces()
  const entries = new Map<string, Entry>()
  const services = new Map<string, { readonly extension: string; readonly impl: unknown }>()
  const remotes = new Map<string, Provider>()
  // Each live instance's catalog and messages, so a locale change reaches them.
  const translations = new Set<Translation>()
  const reloads = new Map<string, number>()
  const closed = new Set<(win: BrowserWindow) => void>()
  const status = { sequence: 0, disposed: false, menubarQueued: false }

  const broadcast = (event: DesktopEvent) => getMainWindows().forEach((win) => emitIpcEvent(win.webContents, event))
  const changed = () => broadcast(new ExtensionsChanged({ list: installed() }))

  const subscribers = (remote: string, window?: number) => {
    const ids = input.subscriptions.get(remote)

    if (!ids) return []

    return [...ids]
      .filter((id) => window === undefined || id === window)
      .flatMap((id) => {
        const win = BrowserWindow.fromId(id)

        if (win && !win.isDestroyed()) return [win]
        ids.delete(id)

        return []
      })
  }

  const pushState = (remote: string, provider: Provider, window?: number) => {
    const schema = provider.spec.state
    const stateOf = provider.state

    if (!schema || !stateOf) return
    subscribers(remote, window).forEach((win) => {
      const encoded = Schema.encodeUnknownExit(schema)(stateOf(win.id))

      if (Exit.isFailure(encoded))
        return input.log("extension state encoding failed", { remote, cause: String(encoded.cause) })
      emitIpcEvent(win.webContents, new ExtensionState({ remote, state: encoded.value }))
    })
  }

  const menubarItems = () => {
    const items = [...entries.values()].flatMap((entry) => {
      if (entry.point !== Menubar.id) return []
      const item = read(entry)

      return isMenubar(item) ? [{ id: `${entry.extension}.${item.id}`, extension: entry.extension, item }] : []
    })

    const published = new Set(items.map((item) => item.id))

    // `after` names a sibling from the same extension by its local id, or a built-in item.
    return items.map((entry) => {
      const after = entry.item.after
      const sibling = `${entry.extension}.${after}`

      return { ...entry, after: after === undefined ? undefined : published.has(sibling) ? sibling : after }
    })
  }

  const publishMenubar = () => {
    status.menubarQueued = false

    if (status.disposed) return
    refreshMenu()
    broadcast(new ExtensionMenubarChanged({ items: menubar() }))
  }

  const scheduleMenubar = () => {
    if (status.menubarQueued) return
    status.menubarQueued = true
    queueMicrotask(publishMenubar)
  }

  const menubar = (): BridgeMenubarItem[] =>
    menubarItems().map((entry) => {
      const item = {
        menu: entry.item.menu,
        id: entry.id,
        label: entry.item.label,
        enabled: entry.item.enabled?.() ?? true,
      }

      // The IPC schema takes `after` as an optional key: it is left out rather than undefined.
      return entry.after === undefined ? item : { ...item, after: entry.after }
    })

  const server = (id: string): MainServer | undefined => {
    const sidecar = SidecarCredentials.get()

    // The app's own server is known here first-hand; the renderer never holds its credential.
    if (id === "sidecar") {
      if (!sidecar) return undefined
      const authorization = SidecarCredentials.authorization(sidecar, sidecar.url)

      return { id, url: sidecar.url, headers: authorization ? { authorization } : {}, local: true }
    }

    const endpoint = [...input.servers]
      .reverse()
      .flatMap(([window, list]) => {
        if (BrowserWindow.fromId(window)) return list
        input.servers.delete(window)

        return []
      })
      .find((item) => item.id === id)

    if (!endpoint) return undefined

    const authorization = endpoint.password
      ? `Basic ${Buffer.from(`${endpoint.username ?? "opencode"}:${endpoint.password}`).toString("base64")}`
      : SidecarCredentials.authorization(sidecar, endpoint.url)

    return {
      id,
      url: endpoint.url,
      headers: authorization ? { authorization } : {},
      local: !!sidecar && URL.canParse(endpoint.url) && new URL(endpoint.url).origin === sidecar.url,
      username: endpoint.username,
      password: endpoint.password,
    }
  }

  const mainApp = {
    version: VERSION,
    channel: CHANNEL,
    packaged: app.isPackaged,
    server,
    log: (level, message, data) => input.write(level, message, data ?? {}),
  } satisfies Omit<MainApp, "restart">

  const lifecycle = createLifecycle({
    loader: (id) => loader(id),
    enabled: (id) => manager.enabled(id),
    changed: () => changed(),
    log: input.log,
  })

  const loader = (id: string): (() => Promise<Revision>) | undefined => {
    const builtin = local.find((definition) => definition.id === id)

    if (builtin) {
      const main = builtin.main

      if (!main) return undefined

      return () => main().then((module) => prepare(id, { setup: module.default, i18n: builtin.i18n }))
    }

    const manifest = manager.installed().find((item) => item.id === id)?.manifest
    const entry = manifest?.main

    if (!manifest || !entry) return undefined

    return () => {
      const source = manager.file(id, entry)

      if (!source) return Promise.reject(new ExtensionError("invalidManifest"))

      return evaluateMain(source.toString("utf8"), manifest.imports.main ?? []).then((loaded) => prepare(id, loaded))
    }
  }

  const resolveMessages = async (catalog?: Catalog): Promise<Messages> => {
    const english = catalog?.en ?? {}
    const locale = nativeLocale()
    const source = locale === "en" ? undefined : catalog?.[locale]

    if (!source) return english
    const loaded = Predicate.isFunction(source) ? (await source()).default : source

    return { ...english, ...loaded }
  }

  /** A loaded revision of the extension's main code; each instance of it gets its own setup context. */
  const prepare =
    (id: string, loaded: Loaded): Revision =>
    (instance) =>
      createContext(id, loaded, instance)

  const createContext = (id: string, loaded: Loaded, instance: Instance): ReturnType<Revision> => {
    const signal = instance.scope.signal
    const contribute = instance.contribute
    // Registered first, so it runs last: the instance's surfaces go after everything else it contributed. They are
    // owned by the instance, so releasing them never touches a replacement's.
    contribute(() => surfaces.releaseOwner(instance))
    const translation: Translation = { catalog: loaded.i18n, messages: loaded.i18n?.en ?? {} }
    translations.add(translation)
    contribute(() => {
      translations.delete(translation)
    })
    const clients = new WeakMap<Provider, unknown>()

    const hosts = new Map<string, unknown>([
      [
        Windows.id,
        {
          get: (window) => getMainWindows().find((win) => win.id === window),
          list: getMainWindows,
          focused: () => getLastFocusedWindow() ?? undefined,
          on: (event, handler) => {
            if (event === "open") return contribute(onMainWindow(handler))
            closed.add(handler)

            return contribute(() => {
              closed.delete(handler)
            })
          },
        } satisfies Windows,
      ],
      [
        Surfaces.id,
        {
          create: (view, win) => {
            const surface = surfaces.create(instance, view, win)

            // Created by a setup that outlived its instance: taken down at once, like any late contribution.
            if (signal.aborted) contribute(surface.dispose)

            return surface
          },
        } satisfies Surfaces,
      ],
      [MainStorage.id, createMainStorage(input.state, id)],
      [Cli.id, input.cli],
      [
        MainApp.id,
        {
          ...mainApp,
          restart: (handoff, options) =>
            lifecycle.restart(options?.keep ?? instance.scope, () => input.restart(handoff)),
        } satisfies MainApp,
      ],
    ])

    function add<T>(point: Point<T>, item: T | (() => T | undefined)): Cleanup {
      if (signal.aborted) return () => {}

      const key = `${id}/${++status.sequence}`
      entries.set(key, { point: point.id, extension: id, value: item })

      if (point.id === Menubar.id) scheduleMenubar()

      return contribute(() => {
        if (entries.delete(key) && point.id === Menubar.id) scheduleMenubar()
      })
    }

    function list<T>(point: Point<T>): readonly T[] {
      return [...entries.values()].flatMap((entry) => {
        if (entry.point !== point.id) return []
        const value = read(entry)

        // SAFETY: only `add` stores entries, under the id of the typed point it was given, so this point's items are T.
        return value === undefined ? [] : [value as T]
      })
    }

    function provide<T>(token: Service<T>, impl: T): Cleanup
    function provide<S extends RemoteSpec>(token: Remote<S>, impl: RemoteImpl<S>): Provided<S>
    function provide<T>(token: Service<T> | Remote, impl: T | RemoteImpl<RemoteSpec>) {
      if (token.kind === "service") {
        if (signal.aborted) return () => {}

        const entry = { extension: id, impl }
        services.set(token.id, entry)

        return contribute(() => {
          if (services.get(token.id) === entry) services.delete(token.id)
        })
      }

      // SAFETY: the overloads pair a Remote token only with a RemoteImpl; provideRemote checks each method at runtime.
      return provideRemote(token, impl as RemoteImpl<RemoteSpec>)
    }

    const provideRemote = (token: Remote, impl: RemoteImpl<RemoteSpec>): Provided<RemoteSpec> => {
      const remote = token.id
      const current = remotes.get(remote)

      if (current && current.extension !== id)
        throw new Error(`Remote "${remote}" is already provided by ${current.extension}`)

      const methods = new Map(
        Object.keys(token.spec.methods).map((name) => {
          const method = Predicate.hasProperty(impl, name) ? impl[name] : undefined

          if (!isMethod(method)) throw new Error(`Remote "${remote}" is missing method "${name}"`)

          return [name, (value: Value, caller: Caller) => method.call(impl, value, caller)] as const
        }),
      )

      const stateOf = Predicate.hasProperty(impl, "state") ? impl.state : undefined

      const provider: Provider = {
        extension: id,
        signal,
        spec: token.spec,
        methods,
        state: isState(stateOf) ? (window) => stateOf.call(impl, window) : undefined,
        listeners: new Set(),
      }

      const live = () => remotes.get(remote) === provider

      const dispose = signal.aborted
        ? () => {}
        : contribute(() => {
            if (!live()) return
            remotes.delete(remote)
            broadcast(new ExtensionAvailable({ remote, available: false }))
          })

      if (!signal.aborted) {
        remotes.set(remote, provider)
        broadcast(new ExtensionAvailable({ remote, available: true }))
        pushState(remote, provider)
      }

      return {
        changed(window) {
          if (live()) pushState(remote, provider, window)
        },
        emit(name, data, window) {
          if (!live()) return
          const schema = token.spec.events?.[name]

          if (!schema) throw new Error(`Remote "${remote}" has no event "${name}"`)
          provider.listeners.forEach((listener) => listener(name, data))
          const encoded = Schema.encodeUnknownExit(schema)(data)

          if (Exit.isFailure(encoded))
            return input.log("extension event encoding failed", { remote, name, cause: String(encoded.cause) })
          const event = new ExtensionEvent({ remote, name, data: encoded.value })

          if (window === undefined) return broadcast(event)
          const win = BrowserWindow.fromId(window)

          if (win && !win.isDestroyed()) emitIpcEvent(win.webContents, event)
        },
        dispose,
      }
    }

    function use<T>(token: Host<T>): T
    function use<T>(token: Service<T>): Accessor<T | undefined>
    function use<S extends RemoteSpec>(token: Remote<S>): Accessor<RemoteClient<S> | undefined>
    function use(token: Host<unknown> | Service<unknown> | Remote) {
      if (token.kind === "host") {
        if (!hosts.has(token.id)) throw new Error(`Host service "${token.id}" is unavailable in the main process`)

        return hosts.get(token.id)
      }

      if (token.kind === "service") return () => services.get(token.id)?.impl

      return () => {
        const provider = remotes.get(token.id)

        if (!provider) return undefined
        const cached = clients.get(provider)

        if (cached) return cached
        const created = client(token.id, provider)
        clients.set(provider, created)

        return created
      }
    }

    // Main-to-main calls skip the codecs: both sides already hold decoded values. They carry no window.
    const client = (remote: string, provider: Provider) => ({
      ...Object.fromEntries(
        [...provider.methods].map(([name, method]) => [
          name,
          async (value: Value, options?: { readonly signal?: AbortSignal }) => {
            // A client kept past its provider's disposal reaches nothing.
            if (remotes.get(remote) !== provider) throw new ExtensionError("unavailable")

            return method(value, {
              window: 0,
              signal: AbortSignal.any([signal, provider.signal, ...(options?.signal ? [options.signal] : [])]),
            })
          },
        ]),
      ),
      state: () => provider.state?.(0),
      on: (name: string, listener: (data: Value) => void) => {
        const handler = (event: string, data: Value) => {
          if (event === name) listener(data)
        }

        provider.listeners.add(handler)

        return contribute(() => {
          provider.listeners.delete(handler)
        })
      },
    })

    const context: MainContext = {
      id,
      signal,
      scope: instance.scope,
      cleanup: (fn) => instance.scope.addFinalizer(fn),
      add,
      list,
      provide,
      use,
      t: (key: string, params?: Params) =>
        formatNativeTemplate(translation.messages[key] ?? nativeMessage(key) ?? key, params),
      plural: (key: string, count: number, params?: Params) => {
        const category = nativePluralCategory(count)

        const template =
          translation.messages[`${key}.${category}`] ??
          translation.messages[`${key}.other`] ??
          nativeMessage(`${key}.${category}`) ??
          nativeMessage(`${key}.other`) ??
          key

        return formatNativeTemplate(template, { ...params, count })
      },
    }

    return {
      ready: resolveMessages(loaded.i18n).then((messages) => {
        translation.messages = messages
      }),
      setup: () => loaded.setup(context),
    }
  }

  const known = (id: string) =>
    local.some((definition) => definition.id === id) || manager.installed().some((item) => item.id === id)

  const installed = (): ExtensionInstalled[] => [
    ...local.map((definition) => ({
      id: definition.id,
      // Built-ins are named by the renderer's own copy.
      name: definition.id,
      version: VERSION,
      builtin: true,
      enabled: manager.enabled(definition.id),
      ...revision(reloads.get(definition.id)?.toString()),
      ...failure(lifecycle.failure(definition.id)),
    })),
    ...manager.installed().map((item) => ({
      id: item.id,
      name: item.manifest?.name ?? item.id,
      version: item.manifest?.version ?? "",
      builtin: false,
      enabled: item.enabled,
      ...revision(item.revision),
      ...failure(item.manifest ? lifecycle.failure(item.id) : "invalidManifest"),
    })),
  ]

  const wire = (win: BrowserWindow) => {
    const window = win.id
    const forget = () => input.subscriptions.forEach((ids) => ids.delete(window))
    win.webContents.on(
      "did-start-navigation",
      (event: Electron.Event<{ isMainFrame: boolean; isSameDocument: boolean }>) => {
        if (!event.isMainFrame || event.isSameDocument) return
        // The renderer is reloading: it lays surfaces out and subscribes again once it is back.
        surfaces.reset(window)
        forget()
      },
    )
    win.once("closed", () => {
      surfaces.releaseWindow(window)
      forget()
      input.servers.delete(window)
      closed.forEach((listener) => listener(win))
    })
  }

  getMainWindows().forEach(wire)
  const stopWindows = onMainWindow(wire)

  const stopLocale = onNativeTranslations(() => {
    const locale = nativeLocale()
    void Promise.all(
      [...translations].map(async (translation) => {
        const messages = await resolveMessages(translation.catalog).catch(() => translation.catalog?.en ?? {})

        if (nativeLocale() === locale) translation.messages = messages
      }),
    ).then(scheduleMenubar)
  })

  setMenubarProvider(() =>
    menubarItems().map((entry) => ({
      menu: entry.item.menu,
      id: entry.id,
      label: entry.item.label,
      after: entry.after,
      enabled: () => entry.item.enabled?.() ?? true,
      run: () => entry.item.run(getLastFocusedWindow() ?? undefined),
    })),
  )

  return {
    /** Activates every enabled main extension. The app calls this once its first window is up. */
    async start() {
      const ids = [...local.map((definition) => definition.id), ...manager.installed().map((item) => item.id)]
      await Promise.all(ids.map((id) => lifecycle.activate(id)))
    },
    /** Activates the extension a remote belongs to ahead of `start`. Remote ids start with their extension's id. */
    demand(remote: string) {
      if (remotes.has(remote)) return

      const id = [...local.map((definition) => definition.id), ...manager.installed().map((item) => item.id)].find(
        (id) => remote === id || remote.startsWith(`${id}.`),
      )

      if (id) void lifecycle.activate(id)
    },
    snapshot(remote: string, window: number) {
      const provider = remotes.get(remote)

      if (!provider) return { available: false }
      const schema = provider.spec.state
      const stateOf = provider.state

      if (!schema || !stateOf) return { available: true }

      return { available: true, state: Schema.encodeUnknownSync(schema)(stateOf(window)) }
    },
    async call(
      request: { readonly remote: string; readonly method: string; readonly input?: unknown },
      caller: Caller,
    ) {
      const provider = remotes.get(request.remote)

      if (!provider) throw new ExtensionError("unavailable")
      const method = provider.methods.get(request.method)
      const spec = method ? provider.spec.methods[request.method] : undefined

      if (!method || !spec) throw new ExtensionError("method")

      const value = spec.input
        ? await Schema.decodeUnknownPromise(spec.input)(request.input).catch((cause: unknown) => {
            throw new ExtensionError("input", { cause, message: String(cause) })
          })
        : undefined

      // Withdrawn while the input decoded: the disposed instance is not called.
      if (remotes.get(request.remote) !== provider) throw new ExtensionError("unavailable")

      const output = await method(value, {
        window: caller.window,
        signal: AbortSignal.any([caller.signal, provider.signal]),
      })

      if (!spec.output) return undefined

      return Schema.encodeUnknownPromise(spec.output)(output).catch((cause: unknown) => {
        throw new ExtensionError("output", { cause, message: String(cause) })
      })
    },
    surface: (window: number, id: string, layout?: BridgeLayout) => surfaces.layout(window, id, layout),
    capture: (window: number, id: string) =>
      surfaces.capture(window, id).then((image) => (image ? new Uint8Array(image.toJPEG(90)) : undefined)),
    menubar,
    runMenubar(window: number, id: string) {
      const entry = menubarItems().find((item) => item.id === id)

      if (!entry || !(entry.item.enabled?.() ?? true)) return
      entry.item.run(BrowserWindow.fromId(window) ?? undefined)
    },
    list: installed,
    async enable(id: string) {
      if (!known(id)) throw new ExtensionError("notFound")
      manager.setEnabled(id, true)
      changed()
      await lifecycle.activate(id)
    },
    async disable(id: string) {
      if (!known(id)) throw new ExtensionError("notFound")
      manager.setEnabled(id, false)
      await lifecycle.deactivate(id)
      changed()
    },
    /** A development tool: packaged builds refuse it. A reload that fails keeps the last good revision running. */
    async reload(id: string) {
      if (!known(id)) throw new ExtensionError("notFound")

      if (local.some((definition) => definition.id === id)) reloads.set(id, (reloads.get(id) ?? 0) + 1)
      else manager.bump(id)
      await lifecycle.reload(id)
      changed()
    },
    async install(source: Uint8Array | string) {
      const manifest = await manager.install(source)
      lifecycle.forget(manifest.id)
      await lifecycle.deactivate(manifest.id)
      changed()
      await lifecycle.activate(manifest.id)
    },
    async remove(id: string) {
      if (local.some((definition) => definition.id === id)) throw new ExtensionError("builtin")

      if (!known(id)) throw new ExtensionError("notFound")
      // Inside the queue, so an activation queued meanwhile finds the extension already gone.
      await lifecycle.deactivate(id, () => {
        manager.remove(id)
        input.state.clear(namespace(id))
        lifecycle.forget(id)
      })
      changed()
    },
    source(id: string) {
      const manifest = manager.installed().find((item) => item.id === id)?.manifest

      if (!manifest) throw new ExtensionError("notFound")
      const file = manager.file(id, manifest.renderer)

      if (!file) throw new ExtensionError("notFound")

      return file.toString("utf8")
    },
    /** Disposes every main extension but one a restart handoff keeps; quitting awaits their async cleanups. */
    async dispose() {
      status.disposed = true
      stopWindows()
      stopLocale()
      // The menu is not rebuilt from here on (`publishMenubar`), so a kept extension's items stay in it.
      await lifecycle.dispose()
    },
  }
}

function read(entry: Entry) {
  return isGetter(entry.value) ? entry.value() : entry.value
}

// Installed extensions are plain JavaScript: these check the shapes the SDK types promise before the host relies on them.
function isGetter(value: Item): value is () => Item {
  return Predicate.isFunction(value)
}

function isMethod(value: unknown): value is Method {
  return Predicate.isFunction(value)
}

function isState(value: unknown): value is (window: number) => Value {
  return Predicate.isFunction(value)
}

function isMenubar(value: Item): value is Menubar {
  return (
    Predicate.hasProperty(value, "id") &&
    Predicate.hasProperty(value, "menu") &&
    Predicate.hasProperty(value, "label") &&
    Predicate.hasProperty(value, "run") &&
    Predicate.isString(value.id) &&
    Predicate.isString(value.label) &&
    Predicate.isFunction(value.run)
  )
}

function revision(value: string | undefined) {
  return value === undefined ? {} : { revision: value }
}

function failure(value: string | undefined) {
  return value === undefined ? {} : { error: value }
}
