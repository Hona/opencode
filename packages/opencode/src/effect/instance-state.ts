import { Effect, Fiber, ScopedCache, Scope, ServiceMap } from "effect"
import { Instance, type InstanceContext } from "@/project/instance"
import { Context } from "@/util/context"
import { InstanceRef } from "./instance-ref"
import { registerDisposer } from "./instance-registry"

const TypeId = "~opencode/InstanceState"
const debug = process.env.OPENCODE_E2E_LOG_CLEANUP === "1"

function source() {
  return (
    new Error().stack
      ?.split("\n")
      .map((line) => line.trim())
      .find(
        (line) =>
          line &&
          !line.startsWith("Error") &&
          !line.includes("instance-state.ts") &&
          !line.includes("node:internal") &&
          !line.includes("bun:wrap"),
      ) ?? "unknown"
  )
}

export interface InstanceState<A, E = never, R = never> {
  readonly [TypeId]: typeof TypeId
  readonly cache: ScopedCache.ScopedCache<string, A, E, R>
}

export namespace InstanceState {
  export const bind = <F extends (...args: any[]) => any>(fn: F): F => {
    try {
      return Instance.bind(fn)
    } catch (err) {
      if (!(err instanceof Context.NotFound)) throw err
    }
    const fiber = Fiber.getCurrent()
    const ctx = fiber ? ServiceMap.getReferenceUnsafe(fiber.services, InstanceRef) : undefined
    if (!ctx) return fn
    return ((...args: any[]) => Instance.restore(ctx, () => fn(...args))) as F
  }

  export const context = Effect.gen(function* () {
    return (yield* InstanceRef) ?? Instance.current
  })

  export const directory = Effect.map(context, (ctx) => ctx.directory)

  export const make = <A, E = never, R = never>(
    init: (ctx: InstanceContext) => Effect.Effect<A, E, R | Scope.Scope>,
  ): Effect.Effect<InstanceState<A, E, Exclude<R, Scope.Scope>>, never, R | Scope.Scope> =>
    Effect.gen(function* () {
      const src = debug ? source() : ""
      const cache = yield* ScopedCache.make<string, A, E, R>({
        capacity: Number.POSITIVE_INFINITY,
        lookup: () =>
          Effect.gen(function* () {
            return yield* init(yield* context)
          }),
      })

      if (debug) console.error(`[e2e:instance] register ${src}`)
      const off = registerDisposer((directory) => {
        const start = Date.now()
        if (debug) console.error(`[e2e:instance] invalidate start dir=${directory} src=${src}`)
        return Effect.runPromise(ScopedCache.invalidate(cache, directory)).then(
          () => {
            if (debug)
              console.error(`[e2e:instance] invalidate done dir=${directory} src=${src} (${Date.now() - start}ms)`)
          },
          (err) => {
            if (debug) {
              console.error(`[e2e:instance] invalidate failed dir=${directory} src=${src} (${Date.now() - start}ms)`)
              console.error(err)
            }
            throw err
          },
        )
      })
      yield* Effect.addFinalizer(() => Effect.sync(off))

      return {
        [TypeId]: TypeId,
        cache,
      }
    })

  export const get = <A, E, R>(self: InstanceState<A, E, R>) =>
    Effect.gen(function* () {
      return yield* ScopedCache.get(self.cache, yield* directory)
    })

  export const use = <A, E, R, B>(self: InstanceState<A, E, R>, select: (value: A) => B) =>
    Effect.map(get(self), select)

  export const useEffect = <A, E, R, B, E2, R2>(
    self: InstanceState<A, E, R>,
    select: (value: A) => Effect.Effect<B, E2, R2>,
  ) => Effect.flatMap(get(self), select)

  export const has = <A, E, R>(self: InstanceState<A, E, R>) =>
    Effect.gen(function* () {
      return yield* ScopedCache.has(self.cache, yield* directory)
    })

  export const invalidate = <A, E, R>(self: InstanceState<A, E, R>) =>
    Effect.gen(function* () {
      return yield* ScopedCache.invalidate(self.cache, yield* directory)
    })

  /**
   * Effect finalizers run on the fiber scheduler after the original async
   * boundary, so ALS reads like Instance.directory can be gone by then.
   */
  export const withALS = <T>(fn: () => T) => Effect.map(context, (ctx) => Instance.restore(ctx, fn))
}
