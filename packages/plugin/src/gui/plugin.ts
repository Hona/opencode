import type { Setup } from "./context.js"
import type { Cleanup, DefinitionCheck, Tokens } from "./core.js"
import type { Declarations, Requires, Stores } from "./declarations.js"
import type { MainSetup } from "./main.js"

export type { Cleanup, Declarations, MainSetup, Setup }

/** The declarations a setup's context is typed from. */
type Declared<Id extends string, P extends Tokens, U extends Tokens, R extends Requires, S extends Stores> = {
  readonly id: Id
  readonly provides: P
  readonly uses: U
  readonly requires: R
  readonly stores: S
}

/**
 * A plugin's GUI: the default export of its `./gui` bundle. Its `Declarations`, then a window setup, a main-process
 * setup, or both. The app's built-in plugins declare with it too.
 */
export type Definition<
  Id extends string = string,
  P extends Tokens = Tokens,
  U extends Tokens = Tokens,
  R extends Requires = Requires,
  S extends Stores = Stores,
> = Declarations<Id, P, U, R, S> & {
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
 * @param plugin - The declarations and at least one setup.
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
  plugin: Definition<Id, P, U, R, S> & WithSetup & DefinitionCheck<Definition<Id, P, U, R, S>>,
): Definition<Id, P, U, R, S>
/**
 * Declares a plugin's GUI without setups, so setups written in other files are typed from it
 * (`Plugin.Setup<typeof definition>`) and the app's host lists can attach their own entries. Returns only the
 * declarations.
 *
 * @param plugin - The declarations.
 * @returns The same object.
 */
export function define<
  const Id extends string,
  const P extends Tokens = {},
  const U extends Tokens = {},
  const R extends Requires = {},
  const S extends Stores = {},
>(plugin: Declarations<Id, P, U, R, S> & DefinitionCheck<Declarations<Id, P, U, R, S>>): Declarations<Id, P, U, R, S>
/**
 * Returns the plugin as it is; the overloads above carry its types.
 *
 * @param plugin - The declarations, with any setups.
 * @returns The same object.
 */
export function define(plugin: Definition) {
  return plugin
}

// A bundle's default export needs a setup; without one, `define` returns only the declarations.
type WithSetup = { readonly setup: unknown } | { readonly main: unknown }
