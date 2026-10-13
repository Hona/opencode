import type { Setup } from "./context"
import type {
  Catalog,
  Cleanup,
  Contract,
  DefinitionCheck,
  Ipc,
  MainStoreDeclaration,
  OS,
  StoreDeclaration,
  Tokens,
} from "./core"
import type { MainSetup } from "./main"

export type { Cleanup, MainSetup, Setup }

/** The hard dependencies a plugin's GUI may declare in `requires`. */
type Requires = Readonly<Record<string, Contract<unknown> | Ipc>>

/** The stores a plugin's GUI may declare. */
type Stores = Readonly<Record<string, StoreDeclaration | MainStoreDeclaration>>

/** The declarations a setup's context is typed from. */
type Declared<Id extends string, P extends Tokens, U extends Tokens, R extends Requires, S extends Stores> = {
  readonly id: Id
  readonly provides: P
  readonly uses: U
  readonly requires: R
  readonly stores: S
}

/**
 * A plugin's GUI: the default export of its `./gui` bundle. Its declarations are the same as a built-in's: what it
 * provides and uses, its stores, its catalog and the systems it runs on. Then a window setup, a main-process setup, or
 * both.
 */
export type Definition<
  Id extends string = string,
  P extends Tokens = Tokens,
  U extends Tokens = Tokens,
  R extends Requires = Requires,
  S extends Stores = Stores,
> = {
  /** The server plugin's id. The plugin fails to load when it differs. */
  readonly id: Id
  /** Restricts the GUI to these systems; omit it to run on every one. */
  readonly os?: readonly OS[]
  /** The contracts the window setup provides and the Ipcs the main setup provides. Each is in `ctx.uses` too. */
  readonly provides?: P
  /** Optional dependencies on other plugins' tokens. */
  readonly uses?: U
  /** Hard dependencies: setup runs only while every one is active. */
  readonly requires?: R
  /** Declared stored state: `Store.global`, `Store.session` or `Store.main`. */
  readonly stores?: S
  /** The plugin's copy by locale, every locale inline. */
  readonly i18n?: Catalog
  /** Runs in every desktop app window. See `Setup`. */
  readonly setup?: Setup<NoInfer<Declared<Id, P, U, R, S>>>
  /** Runs once in the desktop app's main process. See `MainSetup`. */
  readonly main?: MainSetup<NoInfer<Declared<Id, P, U, R, S>>>
}

/**
 * Defines a plugin's GUI, the default export of its `./gui` bundle, as `Plugin.define` from `@opencode/plugin` and
 * `@opencode/plugin/tui` define its server and terminal halves. `id` must be the server plugin's id. Each setup's
 * context is typed from the declarations. Fails to compile, naming the key, when a key names one token in `provides` and
 * another in `uses`.
 *
 * @param plugin - The declarations and the setups.
 * @returns The same object.
 *
 * @example
 * ```tsx
 * export default Plugin.define({
 *   id: "acme",
 *   provides: { acme: Acme },
 *   setup(ctx) {
 *     ctx.add(Command, { id: "open", title: ctx.t("open"), run: () => void ctx.client?.rpc(AcmeRpc).open({}) })
 *   },
 *   main(ctx) {
 *     ctx.provide(Acme, { ping: () => "pong" })
 *   },
 * })
 * ```
 */
export function define<
  const Id extends string,
  const P extends Tokens = {},
  const U extends Tokens = {},
  const R extends Requires = {},
  const S extends Stores = {},
>(
  plugin: Definition<Id, P, U, R, S> & DefinitionCheck<Definition<Id, P, U, R, S>>,
): Definition<Id, P, U, R, S> {
  return plugin
}
