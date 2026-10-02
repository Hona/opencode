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
  RemoteRef,
  Service,
  StoreDeclaration,
  TokenValue,
} from "./core"
import type { SessionRef } from "./services"

/**
 * What every renderer entry gets. Contracts other extensions provide are read through `Setup<typeof Definition>`, from
 * the tokens the definition declares.
 */
export interface Context extends BaseContext {
  use<T>(token: Host<T>): T
}

type Handle<S> =
  S extends StoreDeclaration<infer Schema, infer Scope>
    ? Scope extends "app"
      ? Persisted<Schema["Type"], Schema["Type"]>
      : (session: SessionRef) => Persisted<Schema["Type"]>
    : never

type Provides<D> = Declared<D, "provides">[keyof Declared<D, "provides">]

type Uses<D> = Declared<D, "uses">[keyof Declared<D, "uses">]

/** The full token of a declared reference (`Remote.ref`). */
type Full<T> = T extends RemoteRef<infer S> ? Remote<S> : never

/** The context `Setup<typeof Definition>` receives: the host's members, and only the contracts the definition declares. */
export interface SetupContext<D> extends Omit<Context, "use" | "provide"> {
  use<T>(token: Host<T>): T
  /**
   * The accessor `uses` holds for a declared token: the provider followed through `Live`. The full token of a declared
   * reference also resolves that reference.
   */
  use<T extends Uses<D> | Full<Uses<D>>>(token: T): Accessor<Live<TokenValue<T>>>
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

/** A renderer entry: `Setup<typeof Definition>` types the context from the definition's declarations. */
export type Setup<D extends Definition> = (ctx: SetupContext<D>) => Result
