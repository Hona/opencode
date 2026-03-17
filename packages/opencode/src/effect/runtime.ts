import { Effect, Layer, ManagedRuntime } from "effect"
import { AccountService } from "@/account/service"
import { AuthService } from "@/auth/service"
import { InstanceContext } from "@/effect/instance-context"
import { Instances } from "@/effect/instances"
import type { InstanceServices } from "@/effect/instances"
import { Instance } from "@/project/instance"

export const runtime = ManagedRuntime.make(
  Layer.mergeAll(AccountService.defaultLayer, Instances.layer).pipe(Layer.provideMerge(AuthService.defaultLayer)),
)

export function runPromiseInstance<A, E>(effect: Effect.Effect<A, E, InstanceServices>) {
  return runtime.runPromise(effect.pipe(Effect.provide(Instances.get(Instance.directory))))
}

export function scoped<S, E>(layer: Layer.Layer<S, E, InstanceContext>): <A, E2>(effect: Effect.Effect<A, E2, S>) => Promise<A>
export function scoped<S, E, R>(
  layer: Layer.Layer<S, E, InstanceContext | R>,
  provide: Layer.Layer<R>,
): <A, E2>(effect: Effect.Effect<A, E2, S>) => Promise<A>
export function scoped<S, E, R>(layer: Layer.Layer<S, E, InstanceContext | R>, provide?: Layer.Layer<R>) {
  const rt = Instance.state(
    () => {
      const ctx = Layer.sync(InstanceContext, () =>
        InstanceContext.of({
          directory: Instance.directory,
          project: Instance.project,
        }),
      )
      if (provide) {
        return ManagedRuntime.make(Layer.fresh(layer).pipe(Layer.provide(ctx), Layer.provideMerge(provide), Layer.orDie))
      }

      return ManagedRuntime.make((Layer.fresh(layer).pipe(Layer.provide(ctx), Layer.orDie) as Layer.Layer<S>))
    },
    (state) => state.dispose(),
  )

  return function <A, E>(effect: Effect.Effect<A, E, S>) {
    return rt().runPromise(effect)
  }
}
