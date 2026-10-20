import type { Catalog, Contract, Ipc, MainStoreDeclaration, OS, StoreDeclaration, Tokens } from "./core.js"

/** The hard dependencies a plugin's GUI may declare in `requires`. */
export type Requires = Readonly<Record<string, Contract<unknown> | Ipc>>

/** The stores a plugin's GUI may declare. */
export type Stores = Readonly<Record<string, StoreDeclaration | MainStoreDeclaration>>

/**
 * What a plugin's GUI declares: its id, what it provides and depends on, its stored state, its copy and the systems it
 * runs on. `Plugin.define` returns this for a definition without setups, so setups in other files are typed from it
 * (`Plugin.Setup<typeof definition>`). The host reads it before any setup runs.
 */
export interface Declarations<
  Id extends string = string,
  P extends Tokens = Tokens,
  U extends Tokens = Tokens,
  R extends Requires = Requires,
  S extends Stores = Stores,
> {
  /**
   * The plugin's id; a plugin's `./gui-experimental` takes its server plugin's id and fails to load with another. It
   * prefixes every id the plugin creates: commands (`<id>.<command>`), panel keys (`<id>:<tab>`), stored keys
   * (`extension.<id>.<key>`), and its contract and Ipc ids (`<id>` or `<id>.<name>`). Changing it moves all of those;
   * migrate them as the guide describes.
   */
  readonly id: Id
  /**
   * The operating systems the plugin runs on. Omit it to run everywhere, the web included. A plugin that lists any OS
   * does not run on the web, where no OS is known.
   */
  readonly os?: readonly OS[]
  /** The plugin's copy. `ctx.t` reads it first, then the app's shared keys such as `common.*`. */
  readonly i18n?: Catalog
  /**
   * Tokens this plugin provides: Contracts from its window setup (`ctx.provide`), Ipcs from its main setup. The host
   * refuses two providers of one token. The window setup also reads each one as `ctx.uses.<key>`, a `Live` accessor, so
   * a plugin that talks to its own main setup lists that Ipc here only.
   */
  readonly provides?: P
  /**
   * Optional dependencies that other plugins provide. Each is a `Live` accessor in `ctx.uses`: pending while its
   * provider loads, inactive while it is disabled, failed, blocked or restarting. The plugin must keep working while
   * one is inactive. Your own tokens need no entry: `provides` already puts them in `ctx.uses`. A key that names one
   * token in `provides` and another here fails to compile (`Conflict<"key">`).
   */
  readonly uses?: U
  /**
   * Hard dependencies. The host starts the plugin only while every one is active and restarts it with them; the values
   * are plain in `ctx.requires`. Use it only where the plugin is meaningless without the contract. A reference
   * (`Ipc.ref`) is refused: it resolves only once code loads the full token, which setup would do.
   */
  readonly requires?: R
  /**
   * State the host stores for the plugin, by store name. Each process's `ctx.stores` holds only its own:
   * `Store.global` and `Store.session` are window state, loaded before they are read; `Store.main` is main-process
   * state, always loaded. See `Store`. Keys known only at runtime go through `ctx.storage.store`.
   */
  readonly stores?: S
}
