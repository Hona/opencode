import { DialogProvider } from "@opencode/ui/context/dialog"
import type {
  Appearance,
  Build,
  Definition,
  Keybinds,
  Layout,
  Locale,
  Router,
  Servers,
  Setup,
  Storage,
  StoreOptions,
  Workspaces,
} from "@opencode/gui-extensions/sdk"
import { createSignal, getOwner, onCleanup, runWithOwner, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Schema } from "effect"
import { render } from "solid-js/web"
import type { Platform } from "@/runtime/platform/platform"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { ExtensionHostProvider, useExtensionHost, type HostApiFactories } from "../src/runtime/extension/host"
import { ExtensionSlot } from "../src/runtime/extension/render"
import { persistedHandle } from "../src/runtime/extension/stores"
import { LanguageProvider } from "../src/runtime/i18n/language"

export { Contract, createKeyed, Slot, Store } from "@opencode/gui-extensions/sdk"

export { Schema }

type ExtensionHost = ReturnType<typeof useExtensionHost>

/** A value the fixture's storage holds as JSON. */
type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json }

export { createSignal, getOwner, onCleanup, runWithOwner }

const layout: Layout = {
  narrow: () => false,
  ready: () => true,
  open() {},
  close() {},
  toggle() {},
  state: () => "closed",
  stored: () => [],
  side: { opened: () => false, toggle() {} },
  sidebar: { opened: () => true },
  dock: { opened: () => false, placement: () => "bottom" },
  scroll: { get: () => undefined, set() {} },
  settings() {},
  project() {},
}

const build: Build = { version: "", channel: "dev", platform: "desktop", packaged: false }

const locale: Locale = { locale: () => "en", direction: () => "ltr", setDirection() {} }

const appearance: Appearance = { font: () => "monospace" }

const router: Router = { routing: () => false, path: () => "/" }

const keybinds: Keybinds = { keybind: () => [], keys: (bind) => bind.split("+"), matches: () => false }

const servers: Servers = { list: () => [] }

const workspaces: Workspaces = { on: () => () => undefined }

/** Every HostApi faked at its boundary, with the given storage. */
function fakeApis(storage: (extension: string) => Storage): HostApiFactories {
  return {
    build: () => build,
    locale: () => locale,
    appearance: () => appearance,
    router: () => router,
    keybinds: () => keybinds,
    servers: () => servers,
    workspaces: () => workspaces,
    desktop: () => undefined,
    sessions: () => ({ list: () => [], current: () => undefined }),
    layout: () => layout,
    storage,
    system: () => ({ copy: async () => {}, save: async () => false, openExternal() {} }),
    embeds: () => ({ View: () => null, capture: async () => undefined }),
  }
}

/** Storage that no test of `mountExtensionHost` reads. */
const unused = (): Storage => {
  throw new Error("The fixture extension reads no storage")
}

/** Resolves once `check` holds, checking every frame; rejects after five seconds. */
export async function until(check: () => boolean) {
  const deadline = performance.now() + 5000

  while (!check()) {
    if (performance.now() > deadline) throw new Error("The fixture never reached the expected state")
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
}

/** Mounts the real extension host with one extension whose every renderer load settles when the test says so. */
export function mountExtensionHost() {
  const loads: PromiseWithResolvers<{ default: Setup<Definition> }>[] = []
  const [disabled, setDisabled] = createSignal<ReadonlySet<string>>(new Set())
  const hosts: ExtensionHost[] = []
  const container = document.createElement("div")
  document.body.appendChild(container)

  function Capture() {
    hosts.push(useExtensionHost())

    return null
  }

  const dispose = render(
    () => (
      <LanguageProvider locale="en">
        <DialogProvider>
          <ExtensionHostProvider
            definitions={[
              {
                id: "fixture",
                renderer: () => {
                  const load = Promise.withResolvers<{ default: Setup<Definition> }>()
                  loads.push(load)

                  return load.promise
                },
              },
            ]}
            disabled={disabled}
            apis={fakeApis(unused)}
          >
            <Capture />
          </ExtensionHostProvider>
        </DialogProvider>
      </LanguageProvider>
    ),
    container,
  )

  return {
    unmount: () => {
      dispose()
      container.remove()
    },
    /** Resolves the nth renderer load (the first by default) with this setup. */
    load: (setup: Setup<Definition>, index = 0) => loads[index].resolve({ default: setup }),
    /** Rejects the nth renderer load. */
    fail: (index: number, cause: unknown) => loads[index].reject(cause),
    /** Renderer loads requested so far. */
    count: () => loads.length,
    reload: () => hosts[0]?.reload("fixture"),
    disable: () => setDisabled(new Set(["fixture"])),
    enable: () => setDisabled(new Set<string>()),
    status: () => hosts[0]?.state.status.fixture,
    /** Contributions the host holds for a point; readable after the host unmounts. */
    entries: (point: string) => hosts[0]?.state.entries[point]?.length ?? 0,
  }
}

/**
 * Mounts the real host over these definitions, before any session mounts, with the HostApis faked at their
 * boundary. Storage is the real persisted store of a desktop window whose reads wait until `release()`; `stored` seeds
 * it. Renders the `window.bottom` slot once the startup gate opens.
 */
export function mountExtensions(input: {
  definitions: readonly Definition[]
  disabled?: readonly string[]
  stored?: Readonly<Record<string, Json>>
}) {
  const held = Promise.withResolvers<void>()
  const [disabled, setDisabled] = createSignal<ReadonlySet<string>>(new Set(input.disabled ?? []))
  const hosts: ExtensionHost[] = []
  const container = document.createElement("div")
  document.body.appendChild(container)

  const platform: Platform = {
    platform: "desktop",
    windowID: "extension-host-fixture",
    openExternal: () => undefined,
    openDirectoryPickerDialog: async () => null,
    restart: async () => undefined,
    notify: async () => undefined,
    storage: () => ({
      getItem: async (key: string) => {
        await held.promise

        return key in (input.stored ?? {}) ? JSON.stringify(input.stored?.[key]) : null
      },
      setItem: async () => undefined,
      removeItem: async () => undefined,
    }),
  }

  const storage = (extension: string): Storage => ({
    store<S extends Schema.ConstraintCodec<object, unknown>>(key: string, options: StoreOptions<S>) {
      const pair = persisted(Persist.global(`extension.${extension}.${key}`), options.schema, options.initial, platform)

      return persistedHandle({ store: pair[0], set: pair[1], init: pair[3].promise })
    },
    memory: (_key, options) => {
      const [value, set] = createStore(options.initial)

      return [value, (mutation) => set(produce(mutation))] as const
    },
    remove() {},
  })

  function MountedHost() {
    return (
      <ExtensionHostProvider definitions={input.definitions} disabled={disabled} apis={fakeApis(storage)}>
        <Capture />
      </ExtensionHostProvider>
    )
  }

  function Capture() {
    const host = useExtensionHost()
    hosts.push(host)

    return (
      <Show when={host.ready()}>
        <ExtensionSlot at="window.bottom" input={{}} />
      </Show>
    )
  }

  const dispose = render(
    () => (
      <LanguageProvider locale="en">
        <DialogProvider>
          <MountedHost />
        </DialogProvider>
      </LanguageProvider>
    ),
    container,
  )

  return {
    container,
    unmount: () => {
      dispose()
      container.remove()
    },
    /** Lets the held storage reads answer. */
    release: () => held.resolve(),
    disable: (ids: readonly string[]) => setDisabled(new Set(ids)),
    reload: (id: string) => hosts[0]?.reload(id),
    ready: () => hosts[0]?.ready() ?? false,
    status: (id: string) => hosts[0]?.state.status[id],
    failure: (id: string) => hosts[0]?.state.failures[id],
    entries: (point: string) => hosts[0]?.state.entries[point]?.length ?? 0,
  }
}
