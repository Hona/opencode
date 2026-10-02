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
import { Live, type Remote, type RemoteClient, type Service, type Token } from "./core"
import { Sessions } from "./services"
import { LifetimeContext, useExtension } from "./solid"

type Falsy = undefined | null | false

/**
 * A token, a `Live` accessor such as `ctx.uses.name`, or any accessor. A token the definition declares is followed
 * through `Live`; an undeclared one follows the identity of its provider's value.
 */
export type ActiveSource = Token | Accessor<unknown>

/** What a source gives while it is active. A plain accessor is active while its value is not undefined, null or false. */
export type ActiveValue<S> =
  S extends Remote<infer Spec>
    ? RemoteClient<Spec>
    : S extends Service<infer T>
      ? T
      : S extends Accessor<Live<infer T>>
        ? T
        : S extends Accessor<infer T>
          ? Exclude<T, Falsy>
          : never

/** One run of `createActive`: the source's value, or none while it is not active. */
type Run = { readonly value: unknown; readonly generation?: number } | undefined

/**
 * Runs `fn` once per active generation of a token or `Live` accessor, or once per identity of a plain accessor's value.
 * Each run, and each run of `otherwise` while the source is not active, has its own owner: its `onCleanup` and its
 * registrations end with it. This is the way extension code runs side effects reactively.
 */
export function createActive<S extends ActiveSource>(
  source: S,
  fn: (value: ActiveValue<S>) => void,
  options?: { readonly otherwise?: () => void },
) {
  const input: ActiveSource = source
  const read = isToken(input) ? follow(input) : input

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
      // SAFETY: `current.value` comes from `source`, and `ActiveValue<S>` is what that source gives while active.
      const run = current === undefined ? options?.otherwise : () => fn(current.value as ActiveValue<S>)

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

function isToken(source: ActiveSource): source is Token {
  return "kind" in source
}

/** The extension context's accessor for a token. */
function follow(token: Token): Accessor<unknown> {
  const ctx = useExtension()

  return token.kind === "service" ? ctx.use(token) : ctx.use(token)
}

/**
 * The latest result of `fetch` for the source's current value. Never suspends. A new value aborts the previous request
 * through its signal and drops its reply; so does the owner going away. `latest` keeps the last result meanwhile.
 */
export function createLatest<S extends ActiveSource, T>(
  source: S,
  fetch: (value: ActiveValue<S>, signal: AbortSignal) => Promise<T>,
): { readonly latest: T | undefined; readonly loading: boolean; readonly error: unknown } {
  const [state, setState] = createStore<{ latest: T | undefined; loading: boolean; error: unknown }>({
    latest: undefined,
    loading: false,
    error: undefined,
  })

  createActive(
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

/** State that returns to `initial` on every routing visit of the current session (`SessionView.visit`). */
export function createVisitState<T>(initial: T) {
  const sessions = useExtension().use(Sessions)
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
