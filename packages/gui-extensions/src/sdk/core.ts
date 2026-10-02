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

/**
 * What an entry's setup returns. Teardown is not returned: a window entry uses Solid's `onCleanup` (setup runs under
 * the extension's root owner) and `ctx.signal`; a main entry uses `ctx.scope.addFinalizer` and `ctx.scope.signal`.
 */
type Result = void | Promise<void>

/** The running build. One shape in the window and in main. */
export interface Build {
  /**
   * The app version. Web and desktop windows always know it; it is empty only in a window whose platform reports none,
   * such as a test or Storybook fixture, as no build-time version constant exists in every build.
   */
  readonly version: string
  readonly channel: "local" | "dev" | "beta" | "prod"
  /** Main is always "desktop". */
  readonly platform: "web" | "desktop"
  /** A packaged desktop app, not a development run. Always false on the web. */
  readonly packaged: boolean
}

export interface Definition {
  /** Prefix of every id the extension creates: commands, panels, settings, storage, contracts, points. */
  readonly id: string
  readonly os?: readonly OS[]
  readonly i18n?: Catalog
  /** Contracts this extension provides: Contracts from its renderer entry, Ipcs from its main entry. */
  readonly provides?: Tokens
  /** Optional contracts. Each is a `Live` accessor in `ctx.uses`; the extension must work while one is inactive. */
  readonly uses?: Tokens
  /**
   * Hard contracts. The host starts the extension only while every one is active and restarts it with them; the
   * values are plain in `ctx.requires`. Use it only where the extension is meaningless without the contract. A
   * reference (`Ipc.ref`) is refused: it resolves only once code loads the full token, which setup would do.
   */
  readonly requires?: Readonly<Record<string, Contract<unknown> | Ipc>>
  /** State the host stores for the extension and loads before it is read. See `Store`. */
  readonly stores?: Readonly<Record<string, StoreDeclaration>>
  readonly renderer?: () => Promise<{ readonly default: (ctx: never) => Result }>
  /** The main entry; its default export is a `MainSetup` (`@opencode/gui-extensions/sdk/main`). */
  readonly main?: () => Promise<{ readonly default: (ctx: never) => Result }>
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
export interface Contract<T, Id extends string = string> {
  readonly kind: "contract"
  readonly id: Id
  readonly [brand]?: T
}

type Codec = Schema.ConstraintCodec<unknown, unknown>

export interface IpcMethod {
  readonly input?: Codec
  readonly output?: Codec
}

export interface IpcSpec {
  readonly id: string
  readonly state?: Codec
  readonly methods: Readonly<Record<string, IpcMethod>>
  readonly events?: Readonly<Record<string, Codec>>
}

/** A contract provided in the main process and used from the renderer over the IPC bridge. */
export interface Ipc<S extends IpcSpec = IpcSpec> {
  readonly kind: "ipc"
  readonly id: string
  readonly spec: S
}

/** An Ipc declared by id and typed by its token, with no spec at runtime. See `Ipc.ref`. */
export interface IpcRef<S extends IpcSpec = IpcSpec> {
  readonly kind: "ipc"
  readonly id: string
  readonly spec?: undefined
  readonly [brand]?: S
}

/** A contract one extension provides and others declare in `uses` or `requires`. */
export type Token = Contract<unknown> | Ipc | IpcRef

export type Tokens = Readonly<Record<string, Token>>

type TypeOf<C> = C extends Codec ? C["Type"] : void

/** What the renderer reads from `ctx.uses.name` for an Ipc. Methods are async; state is synced per window. */
export type IpcClient<S extends IpcSpec> = {
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

/** The value a token gives its users: the contract itself, or the client of an Ipc. */
export type TokenValue<T> =
  T extends Ipc<infer S>
    ? IpcClient<S>
    : T extends IpcRef<infer S>
      ? IpcClient<S>
      : T extends Contract<infer V>
        ? V
        : never

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
  /** For the host: marks the accessors `ctx.uses` holds, so `createKeyed` follows their generations. */
  accessor: <T>(read: () => Live<T>): Accessor<Live<T>> => Object.assign(read, { [live]: true }),
  /** The accessor is one the host marked with `Live.accessor`. */
  is: (source: Accessor<unknown>): source is Accessor<Live<unknown>> => live in source,
}

/** Identifies the renderer window an Ipc call came from. Main uses it to scope state and events. */
export interface Caller {
  readonly window: number
  readonly signal: AbortSignal
}

/** What main passes to `ctx.provide(ipc, impl)`. */
export type IpcImpl<S extends IpcSpec> = {
  readonly [Name in keyof S["methods"]]: (
    input: TypeOf<S["methods"][Name]["input"]>,
    caller: Caller,
  ) => TypeOf<S["methods"][Name]["output"]> | Promise<TypeOf<S["methods"][Name]["output"]>>
} & (S["state"] extends Codec ? { state(window: number): TypeOf<S["state"]> } : unknown)

/** Returned by `ctx.provide(ipc, impl)` in main. */
export interface IpcProvider<S extends IpcSpec> {
  /** Re-reads `impl.state` and sends it to one window, or to every window. */
  changed(window?: number): void
  emit<Name extends keyof NonNullable<S["events"]> & string>(
    name: Name,
    data: TypeOf<NonNullable<S["events"]>[Name]>,
    window?: number,
  ): void
  dispose(): void
}

/**
 * What every entry gets, in the window and in main. Each process adds the APIs its host always provides as properties
 * (`ctx.layout`, `ctx.storage`, …), created on first read, and `provide` for the contracts it hosts.
 */
export interface BaseContext {
  readonly id: string
  /**
   * Contribute an item. Pass a function to contribute reactively; return undefined to withdraw. The item is withdrawn
   * with the current owner (for example a `createKeyed` run or a component), else with the extension.
   */
  add<T>(point: Point<T>, item: T | (() => T | undefined)): Cleanup
  /** Read contributions to a point this extension owns. Reactive. */
  list<T>(point: Point<T>): readonly T[]
  /** Resolves this extension's catalog, then the app's shared keys. */
  t(key: string, params?: Params): string
  plural(key: string, count: number, params?: Params): string
}

/**
 * Moves an older stored value into a store once. Where `from` takes a list, it names several older homes, newest
 * first, and the first that holds a value is imported: for example an extension's earlier storage namespace, then the
 * app key that namespace once replaced.
 */
export type StoreFrom =
  | string
  | {
      readonly key: string
      /**
       * For session scope: `key` is a global key (e.g. "layout") whose field `sessions` holds every session's
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
  Scope extends "global" | "session" = "global" | "session",
> {
  readonly scope: Scope
  readonly schema: S
  readonly initial: S["Type"]
  /** Imports an older host key once, as `Storage.store`'s `from` does. */
  readonly from?: StoreFrom | readonly StoreFrom[]
}

export const Store = {
  /** One value for the app. The host loads it before setup, so `ctx.stores.name.value` is never undefined. */
  global: <S extends StoreSchema>(
    schema: S,
    initial: NoInfer<S["Type"]>,
    from?: StoreFrom | readonly StoreFrom[],
  ): StoreDeclaration<S, "global"> => ({
    scope: "global",
    schema,
    initial,
    from,
  }),
  /** One value per session. The host loads it when the session mounts; `value` is undefined until then. */
  session: <S extends StoreSchema>(
    schema: S,
    initial: NoInfer<S["Type"]>,
    from?: StoreFrom | readonly StoreFrom[],
  ): StoreDeclaration<S, "session"> => ({ scope: "session", schema, initial, from }),
}

/** Stored state. `V` is the value's type while it may still be loading. */
export interface Persisted<T, V = T | undefined> {
  /** Undefined until the stored value has loaded. Reactive. */
  readonly value: V
  /** The stored value has loaded. Reactive. */
  ready(): boolean
  /**
   * Changes the stored value. Waits until it has loaded, then applies in call order. The mutation edits `draft` in
   * place, or returns the next value, which replaces the stored one; return nothing after editing the draft.
   */
  update(mutation: (draft: T) => T | void): void
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
export type TokenId<T> =
  T extends Ipc<infer S>
    ? S["id"]
    : T extends IpcRef<infer S>
      ? S["id"]
      : T extends Contract<unknown, infer Id>
        ? Id
        : never

/** `Extension.compose`: a `requires` token no extension in the composition provides. */
export interface Missing<Id extends string> {
  readonly [problem]: Id
}

/** `Extension.compose`: a token two extensions in the composition provide. */
export interface Duplicate<Id extends string> {
  readonly [problem]: Id
}

/** `IpcsProvided`: a renderer `uses` or `requires` of an Ipc that no main entry provides. */
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

type IpcIds<D, K extends "provides" | "uses" | "requires"> = D extends unknown
  ? TokenId<Extract<Declared<D, K>[keyof Declared<D, K>], Ipc | IpcRef>>
  : never

type MissingIpcs<R extends readonly unknown[], M extends readonly unknown[]> = Exclude<
  IpcIds<R[number], "uses"> | IpcIds<R[number], "requires">,
  IpcIds<Extract<M[number], { readonly main: unknown }>, "provides">
>

/**
 * `true` when every Ipc the renderer composition `R` declares in `uses` or `requires` is provided by an entry with a
 * main module in the main composition `M`; otherwise an error type naming the Ipc. Check it once in a file that
 * imports both compositions: `const ipcs: IpcsProvided<typeof renderer, typeof main> = true`.
 */
export type IpcsProvided<R extends readonly unknown[], M extends readonly unknown[]> = [MissingIpcs<R, M>] extends [
  never,
]
  ? true
  : MissingMain<MissingIpcs<R, M>>

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

export const Contract = {
  /** `Contract.define<FileTree, "file.tree">("file.tree")`: the id is a type argument too, so composition errors name it. */
  define: <T, const Id extends string>(id: Id): Contract<T, Id> => ({ kind: "contract", id }),
}

type SpecOf<R> = R extends Ipc<infer S> ? S : never

export const Ipc = {
  define: <const S extends IpcSpec>(spec: S): Ipc<S> => ({ kind: "ipc", id: spec.id, spec }),
  /**
   * Declares an Ipc by id, typed from a type-only import of its token, so a definition can name it in `provides`,
   * `uses` or `requires` without loading its schemas: `Ipc.ref<typeof BrowserPane>("browser.pane")`. Composition
   * checks and `Live` typing treat it as the token. In the renderer it is pending until code in the window loads the
   * full token, e.g. `ctx.uses.pane.load(BrowserPane)` from a chunk that loads later. Declare it in `uses`: a
   * `requires` would wait for a resolution that setup itself would make.
   */
  ref: <R extends Ipc>(id: TokenId<R>): IpcRef<SpecOf<R>> => ({ kind: "ipc", id }),
}
