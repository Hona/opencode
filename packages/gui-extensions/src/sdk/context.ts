import type { Accessor } from "solid-js"
import type {
  BaseContext,
  Build,
  Cleanup,
  Contract,
  Declared,
  DeclaredStores,
  Definition,
  Ipc,
  IpcClient,
  IpcRef,
  Live,
  Persisted,
  StoreDeclaration,
  TokenValue,
} from "./core"
import type {
  Appearance,
  Desktop,
  Dialogs,
  Embeds,
  Keybinds,
  Layout,
  Links,
  Locale,
  Preferences,
  Router,
  Servers,
  SessionRef,
  Sessions,
  Storage,
  System,
  Workspaces,
} from "./host-apis"

/**
 * What every window entry gets. Contracts other extensions provide are read through `Setup<typeof Definition>`, from
 * the tokens the definition declares. The APIs the host always provides are properties, each created on first read.
 * Setup runs under the extension's root owner: Solid's `onCleanup` in setup runs when the extension goes away.
 */
export interface Context extends BaseContext {
  /**
   * Aborts when the extension is disabled, reloaded, or the window closes. After an `await` there is no owner, so
   * return if it aborted, and listen to it for teardown that starts after the await.
   */
  readonly signal: AbortSignal
  provide<T>(token: Contract<T>, impl: T): Cleanup
  readonly layout: Layout
  readonly sessions: Sessions
  readonly storage: Storage
  readonly system: System
  /** Desktop-only abilities; undefined on the web. */
  readonly desktop: Desktop | undefined
  readonly dialogs: Dialogs
  readonly links: Links
  readonly embeds: Embeds
  readonly build: Build
  readonly locale: Locale
  readonly appearance: Appearance
  readonly router: Router
  readonly keybinds: Keybinds
  readonly servers: Servers
  readonly workspaces: Workspaces
  readonly preferences: Preferences
}

type Handle<S> =
  S extends StoreDeclaration<infer Schema, infer Scope>
    ? Scope extends "global"
      ? Persisted<Schema["Type"], Schema["Type"]>
      : (session: SessionRef) => Persisted<Schema["Type"]>
    : never

type Provides<D> = Declared<D, "provides">[keyof Declared<D, "provides">]

/**
 * What `ctx.uses` holds for a token: the provider followed through `Live`. A declared `Ipc.ref` stays pending until
 * the chunk that loads the full token resolves it with `load`.
 */
type Used<T> =
  T extends IpcRef<infer S>
    ? Accessor<Live<IpcClient<S>>> & {
        /** Resolves the reference with its full token, here and in other extensions. Returns this accessor. */
        load(token: Ipc<S>): Accessor<Live<IpcClient<S>>>
      }
    : Accessor<Live<TokenValue<T>>>

/** The context `Setup<typeof Definition>` receives: the host's members, and only the contracts the definition declares. */
export interface SetupContext<D> extends Omit<Context, "provide"> {
  /** Provides a contract the definition declares in `provides`. */
  provide<T extends Extract<Provides<D>, Contract<unknown>>>(token: T, impl: TokenValue<T>): Cleanup
  /** Each optional contract, followed live. */
  readonly uses: { readonly [K in keyof Declared<D, "uses">]: Used<Declared<D, "uses">[K]> }
  /** Each hard contract's value. Setup runs only while all are active and restarts when one changes. */
  readonly requires: { readonly [K in keyof Declared<D, "requires">]: TokenValue<Declared<D, "requires">[K]> }
  /** Global stores are loaded before setup; a session store's value is undefined until that session's store loads. */
  readonly stores: { readonly [K in keyof DeclaredStores<D>]: Handle<DeclaredStores<D>[K]> }
}

/** A window entry: `Setup<typeof Definition>` types the context from the definition's declarations. */
export type Setup<D extends Definition> = (ctx: SetupContext<D>) => void | Promise<void>
