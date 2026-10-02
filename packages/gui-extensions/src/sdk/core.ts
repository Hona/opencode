import type { Schema } from "effect"
import type { Accessor } from "solid-js"

export type Cleanup = () => void | Promise<void>

export type OS = "macos" | "windows" | "linux"

export type Params = Record<string, string | number | boolean>

export type Messages = Readonly<Record<string, string>>

/** English ships inline; other locales load when the user picks them. */
export type Catalog = { readonly en: Messages } & {
  readonly [locale: string]: Messages | (() => Promise<{ readonly default: Messages }>)
}

type Result = void | Cleanup | Promise<void | Cleanup>

/** An entry that takes the context untyped by its definition. The main process still uses this form. */
export type Setup = (ctx: Context) => Result

export interface Definition {
  /** Prefix of every id the extension creates: commands, panels, settings, storage, services, points. */
  readonly id: string
  readonly os?: readonly OS[]
  readonly i18n?: Catalog
  /** Contracts this extension provides: Services from its renderer entry, Remotes from its main entry. */
  readonly provides?: Tokens
  /** Optional contracts. Each is a `Live` accessor in `ctx.uses`; the extension must work while one is inactive. */
  readonly uses?: Tokens
  /**
   * Hard contracts. The host starts the extension only while every one is active and restarts it with them; the
   * values are plain in `ctx.requires`. Use it only where the extension is meaningless without the contract.
   */
  readonly requires?: Tokens
  /** State the host stores for the extension and loads before it is read. See `Store`. */
  readonly stores?: Readonly<Record<string, StoreDeclaration>>
  readonly renderer?: () => Promise<{ readonly default: (ctx: never) => Result }>
  readonly main?: () => Promise<{ readonly default: Setup }>
}

// Loose on purpose: checking an entry's module while its definition is still being inferred would be circular.
type Entries = {
  readonly renderer?: () => Promise<object>
  readonly main?: () => Promise<object>
}

declare const brand: unique symbol

declare const problem: unique symbol

/** A named place that accepts contributions. The owner of the point decides how to render its items. */
export interface Point<T> {
  readonly kind: "point"
  readonly id: string
  readonly [brand]?: T
}

/** An in-process contract. Any interface, no schema, never crosses IPC. */
export interface Service<T, Id extends string = string> {
  readonly kind: "service"
  readonly id: Id
  readonly [brand]?: T
}

/** A capability the host always provides. */
export interface Host<T> {
  readonly kind: "host"
  readonly id: string
  readonly [brand]?: T
}

type Codec = Schema.ConstraintCodec<unknown, unknown>

export interface RemoteMethod {
  readonly input?: Codec
  readonly output?: Codec
}

export interface RemoteSpec {
  readonly id: string
  readonly state?: Codec
  readonly methods: Readonly<Record<string, RemoteMethod>>
  readonly events?: Readonly<Record<string, Codec>>
}

/** A contract provided in the main process and used from the renderer over the IPC bridge. */
export interface Remote<S extends RemoteSpec = RemoteSpec> {
  readonly kind: "remote"
  readonly id: string
  readonly spec: S
}

/** A contract one extension provides and others declare in `uses` or `requires`. */
export type Token = Service<unknown> | Remote

export type Tokens = Readonly<Record<string, Token>>

type TypeOf<C> = C extends Codec ? C["Type"] : void

/** What the renderer gets from `use(remote)`. Methods are async; state is synced per window. */
export type RemoteClient<S extends RemoteSpec> = {
  readonly [Name in keyof S["methods"]]: (
    input: TypeOf<S["methods"][Name]["input"]>,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<TypeOf<S["methods"][Name]["output"]>>
} & {
  state(): TypeOf<S["state"]> | undefined
  on<Name extends keyof NonNullable<S["events"]> & string>(
    name: Name,
    listener: (data: TypeOf<NonNullable<S["events"]>[Name]>) => void,
  ): Cleanup
}

/** The value a token gives its users: the service itself, or the client of a remote. */
export type TokenValue<T> = T extends Remote<infer S> ? RemoteClient<S> : T extends Service<infer V> ? V : never

/**
 * A provider as its users see it. One object per transition, so a reader re-runs only when the provider changes.
 * `generation` counts activations: a provider that restarts comes back with a new one.
 */
export type Live<T> =
  | { readonly status: "pending" }
  | { readonly status: "active"; readonly value: T; readonly generation: number }
  | { readonly status: "inactive"; readonly reason: "disabled" | "failed" | "restarting" }

const live = Symbol.for("opencode.extension.live")

export const Live = {
  /** Host: marks the accessor `use` returns, so `createActive` follows its generations. */
  accessor: <T>(read: () => Live<T>): Accessor<Live<T>> => Object.assign(read, { [live]: true }),
  /** The accessor is one the host marked with `Live.accessor`. */
  is: (source: Accessor<unknown>): source is Accessor<Live<unknown>> => live in source,
}

/** Identifies the renderer window a remote call came from. Main uses it to scope state and events. */
export interface Caller {
  readonly window: number
  readonly signal: AbortSignal
}

/** What main passes to `provide(remote, impl)`. */
export type RemoteImpl<S extends RemoteSpec> = {
  readonly [Name in keyof S["methods"]]: (
    input: TypeOf<S["methods"][Name]["input"]>,
    caller: Caller,
  ) => TypeOf<S["methods"][Name]["output"]> | Promise<TypeOf<S["methods"][Name]["output"]>>
} & (S["state"] extends Codec ? { state(window: number): TypeOf<S["state"]> } : unknown)

/** Returned by `provide(remote, impl)` in main. */
export interface Provided<S extends RemoteSpec> {
  /** Re-reads `impl.state` and sends it to one window, or to every window. */
  changed(window?: number): void
  emit<Name extends keyof NonNullable<S["events"]> & string>(
    name: Name,
    data: TypeOf<NonNullable<S["events"]>[Name]>,
    window?: number,
  ): void
  dispose(): void
}

/** What every entry gets, in the renderer and in main. */
export interface BaseContext {
  readonly id: string
  /** Aborts when the extension is disabled, reloaded, or the window closes. */
  readonly signal: AbortSignal
  /** Runs when the extension goes away; runs at once if it already has, e.g. after an await in setup. */
  cleanup(fn: Cleanup): Cleanup
  /**
   * Contribute an item. Pass a function to contribute reactively; return undefined to withdraw. The item is withdrawn
   * with the current owner (for example a `createActive` generation or a component), else with the extension.
   */
  add<T>(point: Point<T>, item: T | (() => T | undefined)): Cleanup
  /** Read contributions to a point this extension owns. Reactive. */
  list<T>(point: Point<T>): readonly T[]
  provide<T>(token: Service<T>, impl: T): Cleanup
  provide<S extends RemoteSpec>(token: Remote<S>, impl: RemoteImpl<S>): Provided<S>
  /** Resolves this extension's catalog, then the app's shared keys. */
  t(key: string, params?: Params): string
  plural(key: string, count: number, params?: Params): string
}

/** The main process context. The renderer's `Context` follows providers through `Live` instead. */
export interface Context extends BaseContext {
  use<T>(token: Host<T>): T
  /** Follows the provider live: undefined until it exists, and again after it goes away. */
  use<T>(token: Service<T>): Accessor<T | undefined>
  use<S extends RemoteSpec>(token: Remote<S>): Accessor<RemoteClient<S> | undefined>
}

/** Moves an older stored value into a store once. */
export type StoreFrom =
  | string
  | {
      readonly key: string
      /**
       * For session scope: `key` is an app key (e.g. "layout") whose field `sessions` holds every session's
       * state by the host's session key. pick receives only this session's entry, or undefined.
       */
      readonly sessions?: string
      // SAFETY: the older value is stored JSON with no schema of its own; the store decodes what pick returns.
      // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- see SAFETY above
      pick(value: unknown): unknown
    }

type StoreSchema = Schema.ConstraintCodec<object, unknown>

/** A store an extension declares in `Extension.define({ stores })`. Its key is the store's name. */
export interface StoreDeclaration<
  S extends StoreSchema = StoreSchema,
  Scope extends "app" | "session" = "app" | "session",
> {
  readonly scope: Scope
  readonly schema: S
  readonly initial: S["Type"]
  /** Imports an older host key once, as `Storage.store`'s `from` does. */
  readonly from?: StoreFrom
}

export const Store = {
  /** One value for the app. The host loads it before setup, so `ctx.stores.name.value` is never undefined. */
  app: <S extends StoreSchema>(
    schema: S,
    initial: NoInfer<S["Type"]>,
    from?: StoreFrom,
  ): StoreDeclaration<S, "app"> => ({
    scope: "app",
    schema,
    initial,
    from,
  }),
  /** One value per session. The host loads it when the session mounts; `value` is undefined until then. */
  session: <S extends StoreSchema>(
    schema: S,
    initial: NoInfer<S["Type"]>,
    from?: StoreFrom,
  ): StoreDeclaration<S, "session"> => ({ scope: "session", schema, initial, from }),
}

/** Stored state. `V` is the value's type while it may still be loading. */
export interface Persisted<T, V = T | undefined> {
  /** Undefined until the stored value has loaded. Reactive. */
  readonly value: V
  /** The stored value has loaded. Reactive. */
  ready(): boolean
  /** Changes the stored value. Waits until it has loaded, then applies in call order. */
  update(mutation: (draft: T) => void): void
}

/** The tokens a definition declares under `K`; `{}` when it declares none. */
export type Declared<D, K extends "provides" | "uses" | "requires"> = D extends { readonly [P in K]?: infer M }
  ? M extends Tokens
    ? M
    : {}
  : {}

/** The stores a definition declares; `{}` when it declares none. */
export type DeclaredStores<D> = D extends { readonly stores?: infer M }
  ? M extends Readonly<Record<string, StoreDeclaration>>
    ? M
    : {}
  : {}

/** The id a token declares, for compile errors. */
export type TokenId<T> = T extends Remote<infer S> ? S["id"] : T extends Service<unknown, infer Id> ? Id : never

/** `Extension.compose`: a `requires` token no extension in the composition provides. */
export interface Missing<Id extends string> {
  readonly [problem]: Id
}

/** `Extension.compose`: a token two extensions in the composition provide. */
export interface Duplicate<Id extends string> {
  readonly [problem]: Id
}

/** `RemotesProvided`: a renderer `uses` or `requires` of a Remote that no main entry provides. */
export interface MissingMain<Id extends string> {
  readonly [problem]: Id
}

type Literal<Id> = Id extends string ? (string extends Id ? never : Id) : never

// Distributes over a union of definitions, so each contributes its own declared ids.
type Ids<D, K extends "provides" | "uses" | "requires"> = D extends unknown
  ? TokenId<Declared<D, K>[keyof Declared<D, K>]>
  : never

type Others<Ds extends readonly unknown[], I> = { [J in keyof Ds]: J extends I ? never : Ds[J] }[number]

type MissingIds<Ds extends readonly unknown[]> = Exclude<Ids<Ds[number], "requires">, Ids<Ds[number], "provides">>

type DuplicateIds<Ds extends readonly unknown[]> = {
  [I in keyof Ds]: Literal<Ids<Ds[I], "provides">> & Ids<Others<Ds, I>, "provides">
}[number]

/** Compile errors for a composition; `unknown` when it is valid. */
export type Composition<Ds extends readonly unknown[]> = [MissingIds<Ds>] extends [never]
  ? [DuplicateIds<Ds>] extends [never]
    ? unknown
    : { readonly "duplicate provider": Duplicate<DuplicateIds<Ds>> }
  : { readonly "missing provider": Missing<MissingIds<Ds>> }

type RemoteIds<D, K extends "provides" | "uses" | "requires"> = D extends unknown
  ? TokenId<Extract<Declared<D, K>[keyof Declared<D, K>], Remote>>
  : never

type MissingRemotes<R extends readonly unknown[], M extends readonly unknown[]> = Exclude<
  RemoteIds<R[number], "uses"> | RemoteIds<R[number], "requires">,
  RemoteIds<Extract<M[number], { readonly main: unknown }>, "provides">
>

/**
 * `true` when every Remote the renderer composition `R` declares in `uses` or `requires` is provided by an entry with a
 * main module in the main composition `M`; otherwise an error type naming the remote. Check it once in a file that
 * imports both compositions: `const remotes: RemotesProvided<typeof renderer, typeof main> = true`.
 */
export type RemotesProvided<R extends readonly unknown[], M extends readonly unknown[]> = [
  MissingRemotes<R, M>,
] extends [never]
  ? true
  : MissingMain<MissingRemotes<R, M>>

export const Extension = {
  /**
   * Returns the definition with its declarations typed; `Setup<typeof Definition>` reads them. The entries are checked
   * where the definition is composed, so `renderer: () => import("./renderer")` may name `Setup<typeof Definition>`.
   */
  define: <const D extends Omit<Definition, "renderer" | "main"> & Entries>(definition: D): D => definition,
  /**
   * Returns the definitions as they are. Fails to compile when a `requires` token has no provider in the composition,
   * or when two extensions provide the same token.
   */
  compose: <const Ds extends readonly Definition[]>(...definitions: Ds & Composition<Ds>): Ds => definitions,
}

export const Point = {
  define: <T>(id: string): Point<T> => ({ kind: "point", id }),
}

function defineService<T, const Id extends string>(id: Id): Service<T, Id>
/** @deprecated Pass the id as a second type argument too, so composition errors can name it. */
function defineService<T>(id: string): Service<T>
function defineService(id: string) {
  return { kind: "service", id }
}

export const Service = {
  /** `Service.define<FileTree, "file.tree">("file.tree")`. */
  define: defineService,
}

export const Host = {
  define: <T>(id: string): Host<T> => ({ kind: "host", id }),
}

export const Remote = {
  define: <const S extends RemoteSpec>(spec: S): Remote<S> => ({ kind: "remote", id: spec.id, spec }),
}
