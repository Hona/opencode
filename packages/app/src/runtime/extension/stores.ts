import {
  batch,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  on,
  untrack,
  type Accessor,
  type Owner,
} from "solid-js"
import type { Persisted, SessionRef } from "@opencode/gui-extensions/sdk"

const loads = new WeakMap<object, Promise<void>>()

/**
 * What `Storage.store` returns: a `Persisted` whose `update` waits until the stored value has loaded, then applies in
 * call order, and the older `[store, update, ready]` tuple.
 */
export function persistedHandle<T extends object>(input: {
  readonly store: T
  readonly update: (mutation: (draft: T) => void) => void
  readonly ready: Accessor<boolean>
  /** The storage read; undefined when storage answered synchronously. */
  readonly init: Promise<unknown> | undefined
}) {
  const [loaded, setLoaded] = createSignal(!input.init)
  const queue: ((draft: T) => void)[] = []

  // Registered after the store's own hydration on the same read, so queued changes apply over the stored value.
  const load = input.init?.then(() =>
    batch(() => {
      queue.splice(0).forEach(input.update)
      setLoaded(true)
    }),
  )

  void load?.catch(() => undefined)

  // SAFETY: the properties defined here are `Persisted`'s, so the tuple is both shapes.
  const handle = Object.defineProperties([input.store, input.update, input.ready] as const, {
    value: { get: () => (loaded() ? input.store : undefined) },
    ready: { value: loaded },
    update: {
      value: (mutation: (draft: T) => void) => {
        if (untrack(loaded)) return input.update(mutation)
        queue.push(mutation)
      },
    },
  }) as readonly [T, (mutation: (draft: T) => void) => void, Accessor<boolean>] & Persisted<T>

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
      const queue: ((draft: T) => void)[] = []
      const directory = createMemo(() => session.location?.directory)
      // A new directory opens the store again; the store from the old one disposes with the previous run.
      const store = createMemo(on(directory, (value) => (value === undefined ? undefined : input.open(session))))
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
