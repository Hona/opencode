import {
  batch,
  createContext,
  createMemo,
  createResource,
  createRoot,
  getOwner,
  onCleanup,
  runWithOwner,
  untrack,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js"
import { createStore } from "solid-js/store"
import { resolveTemplate } from "@solid-primitives/i18n"
import { pluralCategory } from "@opencode/ui/context/i18n"
import {
  Link,
  Links,
  type Catalog,
  type Cleanup,
  type Context,
  type Definition,
  type Host,
  type LinkHandler,
  type Messages,
  type Point,
  type Remote,
  type RemoteSpec,
  type Service,
} from "@opencode/gui-extensions/sdk"
import { useLanguage } from "@/runtime/i18n/language"

type Entry = { key: string; point: string; extension: string; value: Accessor<unknown> }
export type Item<T> = { readonly key: string; readonly extension: string; readonly value: T }
type Instance = { definition: Definition; context: Context; dispose: () => void }
type Bound = readonly { readonly token: Host<unknown>; create(extension: string): unknown }[]
export type ExtensionStatus = "loading" | "active" | "failed" | "disabled"

const HostContext = createContext<ReturnType<typeof createHost>>()

export function useExtensionHost() {
  const host = useContext(HostContext)
  if (!host) throw new Error("Extension host is unavailable")
  return host
}

export function ExtensionHostProvider(
  props: ParentProps<{
    definitions: readonly Definition[]
    disabled: Accessor<ReadonlySet<string> | undefined>
    services: Bound
    remote?: (token: Remote) => unknown
  }>,
) {
  const host = createHost(props)
  return <HostContext.Provider value={host}>{props.children}</HostContext.Provider>
}

function createHost(input: {
  definitions: readonly Definition[]
  disabled: Accessor<ReadonlySet<string> | undefined>
  services: Bound
  remote?: (token: Remote) => unknown
}) {
  const language = useLanguage()
  const owner = getOwner()
  const hosts = new Map(input.services.map((service) => [service.token.id, service]))
  const provided = new Map<string, { extension: string; impl: unknown }>()
  // Entries are indexed by point and services versioned by token, so a change wakes only its own readers.
  const [state, setState] = createStore({
    entries: {} as Record<string, Entry[] | undefined>,
    services: {} as Record<string, number | undefined>,
    status: {} as Record<string, ExtensionStatus | undefined>,
    errors: {} as Record<string, string | undefined>,
  })
  const instances = new Map<string, Instance>()
  const memos = new Map<string, Accessor<readonly Item<unknown>[]>>()
  const sequence = { value: 0 }

  const items = <T,>(point: Point<T>) => {
    const existing = memos.get(point.id)
    if (existing) return existing() as readonly Item<T>[]
    // Reuse each item object while its value is unchanged so keyed renders do not remount.
    const cache = new Map<string, Item<unknown>>()
    const created = runWithOwner(owner, () =>
      createMemo(() => {
        const next = (state.entries[point.id] ?? []).flatMap((entry) => {
          const value = entry.value()
          if (value === undefined) return []
          const previous = cache.get(entry.key)
          if (previous?.value === value) return [previous]
          const item = { key: entry.key, extension: entry.extension, value }
          cache.set(entry.key, item)
          return [item]
        })
        if (cache.size > next.length) {
          const live = new Set(next.map((item) => item.key))
          cache.forEach((_, key) => {
            if (!live.has(key)) cache.delete(key)
          })
        }
        return next
      }),
    )!
    memos.set(point.id, created)
    return created() as unknown as readonly Item<T>[]
  }
  const list = <T,>(point: Point<T>) => items(point).map((item) => item.value)

  const links: Links = {
    open(link) {
      const handler = untrack(() => list(Link))
        .filter((item) => item.match(link))
        .reduce<LinkHandler | undefined>(
          (best, item) => (!best || (item.priority ?? 0) > (best.priority ?? 0) ? item : best),
          undefined,
        )
      if (!handler) return false
      handler.open(link)
      return true
    },
  }
  hosts.set(Links.id, { token: Links, create: () => links })

  const activate = async (definition: Definition) => {
    const load = definition.renderer
    if (!load) return
    setState("status", definition.id, "loading")
    const module = await load().catch((error: unknown) => {
      fail(definition.id, error)
      return undefined
    })
    if (!module) return
    if (input.disabled()?.has(definition.id) !== false || instances.has(definition.id)) return
    runWithOwner(owner, () =>
      createRoot((dispose) => {
        const instance = createInstance(definition, dispose)
        instances.set(definition.id, instance)
        void Promise.resolve()
          .then(() => untrack(() => module.default(instance.context)))
          .then(
            (cleanup) => {
              if (instances.get(definition.id) !== instance) return
              if (typeof cleanup === "function") instance.context.cleanup(cleanup)
              setState("status", definition.id, "active")
            },
            (error: unknown) => {
              if (instances.get(definition.id) !== instance) return
              deactivate(definition.id)
              fail(definition.id, error)
            },
          )
      }),
    )
  }

  const createInstance = (definition: Definition, dispose: () => void): Instance => {
    const extension = definition.id
    const controller = new AbortController()
    const cleanups = new Set<Cleanup>()
    const messages = createMessages(definition.i18n, language.locale)
    const created = new Map<string, unknown>()
    const own = (fn: Cleanup): Cleanup => {
      if (controller.signal.aborted) return () => {}
      const cleanup = () => {
        if (cleanups.delete(cleanup)) return fn()
      }
      cleanups.add(cleanup)
      return cleanup
    }
    const context = {
      id: extension,
      signal: controller.signal,
      cleanup: own,
      add(point: Point<unknown>, item: unknown) {
        if (controller.signal.aborted) return () => {}
        const value = typeof item === "function" ? createMemo(item as () => unknown) : () => item
        const key = `${extension}/${++sequence.value}`
        setState("entries", point.id, (entries = []) => [...entries, { key, point: point.id, extension, value }])
        return own(() => setState("entries", point.id, (entries = []) => entries.filter((entry) => entry.key !== key)))
      },
      list,
      provide(token: Service<unknown> | Remote, impl: unknown) {
        if (token.kind === "remote") throw new Error("Remotes are provided by an extension's main entry")
        if (controller.signal.aborted) return () => {}
        provided.set(token.id, { extension, impl })
        setState("services", token.id, (value = 0) => value + 1)
        return own(() => {
          if (provided.get(token.id)?.extension !== extension) return
          provided.delete(token.id)
          setState("services", token.id, (value = 0) => value + 1)
        })
      },
      use(token: Host<unknown> | Service<unknown> | Remote<RemoteSpec>) {
        if (token.kind === "host") {
          if (created.has(token.id)) return created.get(token.id)
          const service = hosts.get(token.id)
          if (!service) throw new Error(`Host service "${token.id}" is unavailable`)
          const value = service.create(extension)
          created.set(token.id, value)
          return value
        }
        if (token.kind === "service")
          return () => {
            void state.services[token.id]
            return provided.get(token.id)?.impl
          }
        return () => input.remote?.(token)
      },
      t(key: string, params?: Record<string, string | number | boolean>) {
        const template = messages()[key]
        if (template !== undefined) return resolveTemplate(template, params)
        return language.t(key as Parameters<typeof language.t>[0], params)
      },
      plural(key: string, count: number, params?: Record<string, string | number | boolean>) {
        const current = messages()
        const template = current[`${key}.${pluralCategory(language.intl(), count)}`] ?? current[`${key}.other`]
        if (template !== undefined) return resolveTemplate(template, { ...params, count })
        return language.plural(key as Parameters<typeof language.plural>[0], count, params)
      },
    } as unknown as Context
    return {
      definition,
      context,
      dispose() {
        controller.abort()
        // One batch: every contribution and service of the extension disappears in the same frame.
        batch(() => {
          Array.from(cleanups)
            .reverse()
            .forEach((cleanup) => {
              // Promise.try runs the cleanup synchronously and isolates a throw from the others.
              void Promise.try(cleanup).catch((error: unknown) => console.error(`[extension] ${extension}`, error))
            })
          cleanups.clear()
          Object.entries(state.entries).forEach(([point, entries]) => {
            if (!entries?.some((entry) => entry.extension === extension)) return
            setState("entries", point, (list = []) => list.filter((entry) => entry.extension !== extension))
          })
        })
        dispose()
      },
    }
  }

  const deactivate = (id: string) => {
    const instance = instances.get(id)
    if (!instance) return
    instances.delete(id)
    instance.dispose()
  }

  const fail = (id: string, error: unknown) => {
    console.error(`[extension] ${id}`, error)
    batch(() => {
      setState("status", id, "failed")
      setState("errors", id, error instanceof Error ? (error.stack ?? error.message) : String(error))
    })
  }

  const ready = createMemo(() =>
    !!input.disabled() &&
    input.definitions.every((definition) => {
      if (!definition.renderer) return true
      const status = state.status[definition.id]
      return status === "active" || status === "failed" || status === "disabled"
    }),
  )

  createMemo(() => {
    const disabled = input.disabled()
    if (!disabled) return
    untrack(() =>
      input.definitions.forEach((definition) => {
        if (disabled.has(definition.id)) {
          deactivate(definition.id)
          setState("status", definition.id, "disabled")
          return
        }
        if (instances.has(definition.id) || state.status[definition.id] === "loading") return
        void activate(definition)
      }),
    )
  })
  onCleanup(() => Array.from(instances.keys()).forEach(deactivate))

  return {
    state,
    ready,
    list,
    items,
    links,
    definitions: () => input.definitions,
    context: (id: string) => instances.get(id)?.context,
    fail,
    reload(id: string) {
      const definition = input.definitions.find((item) => item.id === id)
      if (!definition) return
      deactivate(id)
      void activate(definition)
    },
  }
}

function createMessages(catalog: Catalog | undefined, locale: Accessor<string>): Accessor<Messages> {
  const english = catalog?.en ?? {}
  const [messages] = createResource(locale, async (value) => {
    const source = catalog?.[value]
    if (!source || value === "en") return english
    const loaded = typeof source === "function" ? (await source()).default : source
    return { ...english, ...loaded }
  })
  return () => messages.latest ?? english
}
