import { batch, createMemo, createRenderEffect, createRoot, createSignal, on, untrack, type Owner } from "solid-js"
import { produce, reconcile, type SetStoreFunction } from "solid-js/store"
import { Predicate } from "effect"
import type { Persisted, SessionRef, StoreFrom } from "@opencode/gui-extensions/sdk"
import { Persist, type persisted } from "@/runtime/persistence/storage"
import type { SessionStateKey } from "@/runtime/server/scope"

type Mutation<T> = Parameters<Persisted<T>["update"]>[0]

/** One older key persistence imports a store's value from. */
type CopyFrom = NonNullable<Exclude<Parameters<typeof persisted>[0], string>["copyFrom"]>[number]

const loads = new WeakMap<object, Promise<void>>()

/** The storage key of an extension's store: the extension id is its namespace. */
export function storeName(extension: string, key: string) {
  return `extension.${extension}.${key}`
}

/** Where `Storage.store` keeps an extension's app-wide store, with the older keys it imports. */
export function globalStoreTarget(extension: string, key: string, from: StoreFrom | readonly StoreFrom[] | undefined) {
  return { ...Persist.global(storeName(extension, key)), copyFrom: storeImports(from) }
}

/**
 * A store's `from` in the form persistence takes, in order. For a session store, an app key holding every session's
 * state under one field imports only that session's entry.
 */
export function storeImports(
  from: StoreFrom | readonly StoreFrom[] | undefined,
  session?: SessionStateKey,
): CopyFrom[] {
  return [from ?? []].flat().map((item) => (session && sessionCopy(item, session)) || copySpec(item))
}

function copySpec(from: StoreFrom): CopyFrom {
  return Predicate.isString(from) ? { key: from } : from
}

function sessionCopy(from: StoreFrom, session: SessionStateKey): CopyFrom | undefined {
  if (Predicate.isString(from) || !from.sessions) return

  const field = from.sessions

  return {
    key: from.key,
    storage: Persist.global(from.key).storage,
    pick: (value) => {
      const sessions = Predicate.isObject(value) ? value[field] : undefined

      return from.pick(Predicate.isObject(sessions) ? sessions[session] : undefined)
    },
  }
}

/**
 * What `Storage.store` returns: a `Persisted` whose `update` waits until the stored value has loaded, then applies in
 * call order.
 */
export function persistedHandle<T extends object>(input: {
  readonly store: T
  /** The persisted store's setter. */
  readonly set: SetStoreFunction<T>
  /** The storage read; undefined when storage answered synchronously. */
  readonly init: Promise<unknown> | undefined
}) {
  const [loaded, setLoaded] = createSignal(!input.init)
  const queue: Mutation<T>[] = []

  // A mutation edits the draft in place, or returns the next value, which replaces the stored one entirely.
  const apply = (mutation: Mutation<T>) =>
    batch(() => {
      const replaced: T[] = []

      input.set(
        produce((draft) => {
          const next = mutation(draft)

          if (next) replaced.push(next)
        }),
      )
      replaced.forEach((next) => input.set(reconcile(next)))
    })

  // Registered after the store's own hydration on the same read, so queued changes apply over the stored value.
  const load = input.init?.then(() =>
    batch(() => {
      queue.splice(0).forEach(apply)
      setLoaded(true)
    }),
  )

  void load?.catch(() => undefined)

  const handle: Persisted<T> = {
    get value() {
      return loaded() ? input.store : undefined
    },
    ready: loaded,
    update(mutation) {
      if (untrack(loaded)) return apply(mutation)

      queue.push(mutation)
    },
  }

  if (load) loads.set(handle, load)

  return handle
}

/** Settles once a handle from `persistedHandle` has loaded; rejects when its storage read failed. */
export function whenLoaded<T>(handle: Persisted<T>) {
  return loads.get(handle) ?? Promise.resolve()
}

/**
 * A declared session store: one handle per session. A session's storage needs its location, so the store opens once
 * the location is known; changes made before then wait and apply in order.
 */
export function createSessionStore<T extends object>(input: {
  readonly open: (session: SessionRef) => Persisted<T>
  readonly owner: Owner | null
}) {
  const entries = new Map<string, { readonly handle: Persisted<T>; readonly dispose: () => void }>()

  const create = (session: SessionRef) =>
    createRoot((dispose) => {
      const queue: Mutation<T>[] = []
      const pinned = pin(session)
      const directory = createMemo(() => pinned.location?.directory)
      // A new directory opens the store again; the store from the old one disposes with the previous run.
      const store = createMemo(on(directory, (value) => (value === undefined ? undefined : input.open(pinned))))
      // Hands changes made before the location was known to the store, which applies them once it has loaded.
      createRenderEffect(() => {
        const current = store()

        if (current && queue.length > 0) untrack(() => queue.splice(0).forEach((mutation) => current.update(mutation)))
      })

      const handle: Persisted<T> = {
        get value() {
          return store()?.value
        },
        ready: () => store()?.ready() ?? false,
        update(mutation) {
          const current = untrack(store)

          if (current) return current.update(mutation)
          queue.push(mutation)
        },
      }

      return { handle, dispose }
    }, input.owner)

  return {
    get(session: SessionRef) {
      const existing = entries.get(session.key)

      if (existing) return existing.handle
      const created = create(session)
      entries.set(session.key, created)

      return created.handle
    },
    /** Drops the stores of sessions no tab owns any more. */
    prune(keys: ReadonlySet<string>) {
      entries.forEach((entry, key) => {
        if (keys.has(key)) return
        entry.dispose()
        entries.delete(key)
      })
    },
    dispose() {
      entries.forEach((entry) => entry.dispose())
      entries.clear()
    },
  }
}

/**
 * A ref that keeps naming the session `session` names now. A `MountedSession` follows the route to the next
 * session, so its location is read only while it still names this one, and the last location it reported stands
 * meanwhile. The store opens, and reads `server`, only when that location changes.
 */
function pin(session: SessionRef): SessionRef {
  const key = session.key
  const id = session.id
  const tab = session.tab
  const server = session.server
  const location = createMemo<SessionRef["location"]>((last) => (session.key === key ? session.location : last))

  return {
    key,
    id,
    tab,
    server,
    get pending() {
      return session.key === key && session.pending
    },
    get location() {
      return location()
    },
  }
}
