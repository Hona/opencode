import type { Accessor } from "solid-js"
import type {
  BaseContext,
  Cleanup,
  Declared,
  DeclaredStores,
  Definition,
  Host,
  Live,
  Persisted,
  Remote,
  RemoteClient,
  RemoteSpec,
  Service,
  StoreDeclaration,
  TokenValue,
} from "./core"
import type { PersistedStorage, SessionRef, Storage } from "./services"

/** What every renderer entry gets. */
export interface Context extends BaseContext {
  use<T>(token: Host<T>): T
  /**
   * @deprecated Declare the token in `uses` and read `ctx.uses` (or `use` it from `Setup<typeof Definition>`), which
   * follows the provider through `Live`: one object per transition, so every action can answer while the provider is
   * pending or inactive. An undeclared token gives this older accessor, undefined while there is no provider.
   */
  use<T>(token: Service<T>): Accessor<T | undefined>
  /** @deprecated See `use(Service)`. */
  use<S extends RemoteSpec>(token: Remote<S>): Accessor<RemoteClient<S> | undefined>
}

type Handle<S> =
  S extends StoreDeclaration<infer Schema, infer Scope>
    ? Scope extends "app"
      ? Persisted<Schema["Type"], Schema["Type"]>
      : (session: SessionRef) => Persisted<Schema["Type"]>
    : never

type Provides<D> = Declared<D, "provides">[keyof Declared<D, "provides">]

type Uses<D> = Declared<D, "uses">[keyof Declared<D, "uses">]

/** The context `Setup<typeof Definition>` receives: the host's members, and only the contracts the definition declares. */
export interface SetupContext<D> extends Omit<Context, "use" | "provide"> {
  /** `Storage.store` returns a `Persisted` here; see `PersistedStorage`. */
  use(token: Host<Storage>): PersistedStorage
  use<T>(token: Host<T>): T
  /** The accessor `uses` holds for a declared token: the provider followed through `Live`. */
  use<T extends Uses<D>>(token: T): Accessor<Live<TokenValue<T>>>
  /** Provides a service the definition declares in `provides`. */
  provide<T extends Extract<Provides<D>, Service<unknown>>>(token: T, impl: TokenValue<T>): Cleanup
  /** Each optional contract, followed live. */
  readonly uses: { readonly [K in keyof Declared<D, "uses">]: Accessor<Live<TokenValue<Declared<D, "uses">[K]>>> }
  /** Each hard contract's value. Setup runs only while all are active and restarts when one changes. */
  readonly requires: { readonly [K in keyof Declared<D, "requires">]: TokenValue<Declared<D, "requires">[K]> }
  /** App stores are loaded before setup; a session store's value is undefined until that session's store loads. */
  readonly stores: { readonly [K in keyof DeclaredStores<D>]: Handle<DeclaredStores<D>[K]> }
}

type Result = void | Cleanup | Promise<void | Cleanup>

/**
 * A renderer entry. `Setup<typeof Definition>` types the context from the definition's declarations.
 * A bare `Setup` takes the older untyped context; new entries should pass their definition.
 */
export type Setup<D extends Definition = never> = [D] extends [never]
  ? (ctx: Context) => Result
  : (ctx: SetupContext<D>) => Result
