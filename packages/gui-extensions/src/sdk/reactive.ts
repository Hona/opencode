import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  getOwner,
  on,
  onCleanup,
  runWithOwner,
  untrack,
  type Accessor,
} from "solid-js"
import { createStore } from "solid-js/store"
import { Live } from "./core"
import { LifetimeContext, useExtension } from "./solid"

type Falsy = undefined | null | false

/** A `Live` accessor such as `ctx.uses.name`, followed through its generations, or any accessor. */
export type KeyedSource = Accessor<unknown>

/** What a source gives while it is active. A plain accessor is active while its value is not undefined, null or false. */
export type KeyedValue<S> =
  S extends Accessor<Live<infer T>> ? T : S extends Accessor<infer T> ? Exclude<T, Falsy> : never

/** One run of `createKeyed`: the source's value, or none while it is not active. */
type Run = { readonly value: unknown; readonly generation?: number } | undefined

/**
 * Runs `fn` once per key, like `<Show keyed>`: each active generation of a `Live` accessor, or each identity of a plain
 * accessor's value. Each run, and each run of `otherwise` while there is no key, has its own owner: its
 * `onCleanup` and its registrations end with it. This is the way extension code runs side effects reactively.
 */
export function createKeyed<S extends KeyedSource>(
  source: S,
  fn: (value: KeyedValue<S>) => void,
  options?: { readonly otherwise?: () => void },
) {
  const read: KeyedSource = source

  const active = Live.is(read)
    ? createMemo<Run>(
        () => {
          const value = read()

          return value.status === "active" ? value : undefined
        },
        undefined,
        // A Live source changes generation, not merely object, when its provider restarts.
        { equals: (previous, next) => previous?.generation === next?.generation },
      )
    : createMemo<Run>(
        () => {
          const value = read()

          return value === undefined || value === null || value === false ? undefined : { value }
        },
        undefined,
        { equals: (previous, next) => previous?.value === next?.value },
      )

  createRenderEffect(
    on(active, (current) => {
      // SAFETY: `current.value` comes from `source`, and `KeyedValue<S>` is what that source gives while active.
      const run = current === undefined ? options?.otherwise : () => fn(current.value as KeyedValue<S>)

      if (!run) return

      // A root per run, so a registration made through a captured owner after the run ended disposes at once.
      const lifetime = { ended: false }
      const scope = createRoot((dispose) => ({ owner: getOwner(), dispose }))

      onCleanup(() => {
        lifetime.ended = true
        scope.dispose()
      })

      if (scope.owner) scope.owner.context = { ...scope.owner.context, [LifetimeContext.id]: lifetime }
      runWithOwner(scope.owner, run)
    }),
  )
}

/**
 * The latest result of `fetch` for the source's current value. Never suspends. A new value aborts the previous request
 * through its signal and drops its reply; so does the owner going away. `latest` keeps the last result meanwhile.
 */
export function createLatest<S extends KeyedSource, T>(
  source: S,
  fetch: (value: KeyedValue<S>, signal: AbortSignal) => Promise<T>,
): { readonly latest: T | undefined; readonly loading: boolean; readonly error: unknown } {
  const [state, setState] = createStore<{ latest: T | undefined; loading: boolean; error: unknown }>({
    latest: undefined,
    loading: false,
    error: undefined,
  })

  createKeyed(
    source,
    (value) => {
      const controller = new AbortController()

      onCleanup(() => controller.abort())
      setState("loading", true)
      void Promise.try(() => fetch(value, controller.signal)).then(
        (latest) => {
          if (!controller.signal.aborted) setState({ latest, loading: false, error: undefined })
        },
        (cause: unknown) => {
          if (!controller.signal.aborted) setState({ loading: false, error: cause })
        },
      )
    },
    { otherwise: () => setState("loading", false) },
  )

  return state
}

/** State that returns to `initial` on every routing visit of the current session (`MountedSession.visit`). */
export function createVisitState<T>(initial: T) {
  const sessions = useExtension().sessions
  const visit = () => sessions.current()?.visit

  const [state, setState] = createSignal<{ readonly visit: object | undefined; readonly value: T }>({
    visit: undefined,
    value: initial,
  })

  const value = () => {
    const current = state()

    return current.visit !== undefined && current.visit === visit() ? current.value : initial
  }

  const set = (next: T) => void setState({ visit: untrack(visit), value: next })

  return [value, set] as const
}
