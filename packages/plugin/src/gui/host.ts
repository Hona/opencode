/**
 * Host-internal contract between the renderer host (packages/app) and the main host (packages/desktop).
 * Plugins never use this directly; they use Ipc tokens.
 * Payloads are structured-clone values already encoded with the Ipc's schemas. The `ipc` fields name an Ipc by id.
 */

import type { PluginInfo } from "@opencode/client/promise"
import { Predicate, Schema } from "effect"
import type { Cleanup, Declared, Ipc, IpcRef, OS, PluginOptions, TokenId } from "./core.js"
import type { Declarations } from "./declarations.js"
import type { MainSetup } from "./main.js"

/**
 * A plugin as a host runs it: its `Plugin.Declarations`, plus the setups the host loads lazily. A built-in's entries
 * are its `renderer.tsx` and `main.ts`; a plugin's `./gui` bundle becomes a window entry that runs its `setup`.
 */
export interface Entry extends Declarations {
  /** Loads the window setup (`Plugin.Setup<typeof definition>`). */
  readonly windowEntry?: () => Promise<{
    /** The window setup. */
    readonly default: (ctx: never) => Cleanup | void
  }>
  /** Loads the main setup (`Plugin.MainSetup<typeof definition>`). */
  readonly mainEntry?: () => Promise<{
    /** The main setup. */
    readonly default: (ctx: never) => Cleanup | void | Promise<Cleanup | void>
  }>
}

/**
 * Composes the app's built-in plugins for one process, the way the host lists them: each built-in's `Plugin.define`
 * declarations plus the entries the host loads lazily (`windowEntry`, `mainEntry`). Fails to compile, naming the token
 * id, when a `requires` token has no provider (`Missing<"id">`), when two built-ins provide the same token
 * (`Duplicate<"id">`), or when two share an id (`DuplicatePluginId<"id">`).
 *
 * @param entries - Every built-in of one process.
 * @returns The same entries, as an array.
 *
 * @example
 * ```ts
 * export const builtins = compose({ ...pairing, mainEntry: () => import("./pairing/main") }, review)
 * ```
 */
export function compose<const Es extends readonly Entry[]>(...entries: Es & Composition<Es>): Es {
  return entries
}

/**
 * Whether a plugin runs on this system: it lists no OS, or lists this one. On the web, where no OS is known, only a
 * plugin that lists none runs. Both hosts apply it to built-ins and plugins alike.
 *
 * @param declarations - The plugin's declared `os`.
 * @param os - This system, or undefined on the web.
 * @returns True when the plugin runs here.
 */
export function runsOn(declarations: Pick<Declarations, "os">, os: OS | undefined) {
  return !declarations.os || (!!os && declarations.os.includes(os))
}

declare const problem: unique symbol

/** `compose`'s error: a `requires` token that no plugin in the composition provides. */
export interface Missing<Id extends string> {
  /** The token's id. */
  readonly [problem]: Id
}

/** `compose`'s error: a token that two plugins in the composition provide. */
export interface Duplicate<Id extends string> {
  /** The token's id. */
  readonly [problem]: Id
}

/** `compose`'s error: two entries use the same plugin id. */
export interface DuplicatePluginId<Id extends string> {
  /** The repeated plugin id. */
  readonly [problem]: Id
}

/** `IpcsProvided`'s error: a window `provides`, `uses` or `requires` of an Ipc that no main entry provides. */
export interface MissingMain<Id extends string> {
  /** The Ipc's id. */
  readonly [problem]: Id
}

type Literal<Id> = Id extends string ? (string extends Id ? never : Id) : never

// Distributes over a union of entries, so each contributes its own declared ids.
type Ids<D, K extends "provides" | "uses" | "requires"> = D extends unknown
  ? TokenId<Declared<D, K>[keyof Declared<D, K>]>
  : never

type Others<Ds extends readonly unknown[], I> = { [J in keyof Ds]: J extends I ? never : Ds[J] }[number]

type MissingIds<Ds extends readonly unknown[]> = Exclude<Ids<Ds[number], "requires">, Ids<Ds[number], "provides">>

type DuplicateIds<Ds extends readonly unknown[]> = {
  [I in keyof Ds]: Literal<Ids<Ds[I], "provides">> & Ids<Others<Ds, I>, "provides">
}[number]

type EntryId<D> = D extends { readonly id: infer Id } ? Literal<Id> : never

type RepeatedIds<Ds extends readonly unknown[]> = {
  [I in keyof Ds]: EntryId<Ds[I]> & EntryId<Others<Ds, I>>
}[number]

/** Compile errors for a composition; `unknown` when it is valid. */
export type Composition<Ds extends readonly unknown[]> = [RepeatedIds<Ds>] extends [never]
  ? ProvidersCheck<Ds>
  : {
      /** Two entries share this plugin id. */
      readonly "duplicate plugin id": DuplicatePluginId<RepeatedIds<Ds>>
    }

type ProvidersCheck<Ds extends readonly unknown[]> = [MissingIds<Ds>] extends [never]
  ? [DuplicateIds<Ds>] extends [never]
    ? unknown
    : {
        /** Two plugins provide this token. */
        readonly "duplicate provider": Duplicate<DuplicateIds<Ds>>
      }
  : {
      /** No plugin provides this `requires` token. */
      readonly "missing provider": Missing<MissingIds<Ds>>
    }

type IpcIds<D, K extends "provides" | "uses" | "requires"> = D extends unknown
  ? TokenId<Extract<Declared<D, K>[keyof Declared<D, K>], Ipc | IpcRef>>
  : never

// A window reads its own `provides` through `ctx.uses` too, so those Ipcs need a main entry as well.
type MissingIpcs<R extends readonly unknown[], M extends readonly unknown[]> = Exclude<
  IpcIds<R[number], "provides"> | IpcIds<R[number], "uses"> | IpcIds<R[number], "requires">,
  IpcIds<Extract<M[number], { readonly mainEntry: unknown }>, "provides">
>

/**
 * `true` when every Ipc the window composition `R` declares in `provides`, `uses` or `requires` is provided by an entry
 * with a main setup in the main composition `M`; otherwise an error type naming the Ipc. Check it once in a file that
 * imports both compositions.
 *
 * @example
 * ```ts
 * export const ipcs: IpcsProvided<typeof renderer, typeof main> = true
 * ```
 */
export type IpcsProvided<R extends readonly unknown[], M extends readonly unknown[]> = [MissingIpcs<R, M>] extends [
  never,
]
  ? true
  : MissingMain<MissingIpcs<R, M>>

/** One explicit desktop enable-state row. An absent row means there is no setting under that id. */
export interface EnableState {
  /** The plugin id the user saved a setting under. */
  readonly id: string
  /** The saved setting: true enables the plugin; false disables it. */
  readonly enabled: boolean
}

/**
 * Resolves desktop enable state: the row saved under the plugin's id, or enabled when there is none. Both hosts use
 * this rule, including a window's preload snapshot.
 *
 * @param id - The plugin's id.
 * @param state - Explicit saved rows, or the manager's resolved list.
 * @returns Whether the plugin is enabled.
 */
export function pluginEnabled(id: string, state: readonly EnableState[]) {
  return state.find((item) => item.id === id)?.enabled ?? true
}

export { pluginSharedModules, pluginWindowModules, type PluginModule } from "./modules.js"

// Node's `builtinModules`, which a window cannot import; bundles may name them with or without `node:`.
const nodeBuiltins = new Set([
  "assert",
  "assert/strict",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "dns/promises",
  "domain",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "inspector/promises",
  "module",
  "net",
  "os",
  "path",
  "path/posix",
  "path/win32",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "readline/promises",
  "repl",
  "stream",
  "stream/consumers",
  "stream/promises",
  "stream/web",
  "string_decoder",
  "sys",
  "timers",
  "timers/promises",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "util/types",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
])

/**
 * Whether only the desktop app's main process provides a module: `electron` and Node built-ins. A window gives a
 * plugin's `./gui` bundle an inert placeholder for it.
 *
 * @param name - The name the bundle requires.
 * @returns True for `electron`, `node:` names and Node built-ins.
 */
export function mainOnlyModule(name: string) {
  return name === "electron" || name.startsWith("node:") || nodeBuiltins.has(name)
}

/**
 * A placeholder for a module that exists only in the other process, so one plugin `./gui` bundle runs in both: a window
 * gets one for `electron` and Node built-ins, main gets one for Solid and the window-only modules. Bundlers hoist
 * `require` calls and Solid hoists template creation to module scope, so the placeholder accepts any property read,
 * call or construction and returns itself, and ignores writes. It is never a thenable, so a promise never waits on
 * it, and nothing is an instance of it. Code that actually runs in the wrong process gets placeholders back instead of
 * working values; keep each process's code in its entry.
 *
 * @param name - The module's name, shown when the placeholder is converted to a string.
 * @returns The placeholder.
 */
export function inertModule(name: string): InertModule {
  const label = `[inert module ${name}]`

  const handler: ProxyHandler<InertModule> = {
    get(_, key) {
      if (key === "then") return undefined

      if (key === Symbol.toPrimitive || key === "toString") return () => label

      if (key === Symbol.hasInstance) return () => false

      return placeholder
    },
    set: () => true,
    defineProperty: () => true,
    deleteProperty: () => true,
    apply: () => placeholder,
    construct: () => placeholder,
  }

  // Each placeholder wraps its own function, so nothing one bundle does to it reaches another's.
  const placeholder = new Proxy<InertModule>(function inert() {}, handler)

  return placeholder
}

/** A placeholder `inertModule` returns: it answers every property read, call and construction with itself. */
export type InertModule = () => void

/** A plugin's `./gui` bundle as `evaluatePluginBundle` read it. */
export interface PluginBundle {
  /** The declarations of its `Plugin.define`, checked. */
  readonly definition: Declarations
  /** Its window `setup`; undefined in a plugin for main only. */
  readonly setup?: (ctx: never) => Cleanup | void
  /** Its `main` setup; undefined in a plugin for windows only. */
  readonly main?: MainSetup
}

/** The process that evaluates a plugin's `./gui` bundle with `evaluatePluginBundle`. */
export interface PluginBundleHost {
  /** The server plugin's id, which the GUI must declare. */
  readonly id: string
  /**
   * Which process evaluates the bundle.
   * - `window`: checks the dependencies in `uses` and `requires` too.
   * - `main`: drops them; main never reads them, and a token from a window-only module is an inert placeholder there.
   */
  readonly process: "window" | "main"
  /**
   * Returns the module the bundle requires.
   *
   * @param name - The module name the bundle passes to `require`.
   * @returns The module this process provides.
   * @throws For a module this process does not provide.
   */
  require(name: string): object
}

/**
 * Evaluates a plugin's `./gui` bundle, a CommonJS module whose default export is its `Plugin.define`, and checks it:
 * the declarations the host reads, the server plugin's id, and at least one setup. Both hosts call it, each with its own
 * `require`. The bundle's code is trusted as much as the server that runs the app, which already runs the plugin's
 * server entry.
 *
 * @param code - The bundle's CommonJS code.
 * @param host - The process evaluating it.
 * @returns The checked plugin.
 * @throws When evaluation throws, the default export is not a `Plugin.define` this app supports, its id differs, or it
 *   has no setup.
 */
export function evaluatePluginBundle(code: string, host: PluginBundleHost): PluginBundle {
  const id = host.id
  const module: BundleModule = { exports: {} }

  new Function("require", "module", "exports", code)(host.require, module, module.exports)
  // `export default` compiles to `exports.default`, or to `module.exports` itself in a bundler's default mode.
  const plugin = Predicate.hasProperty(module.exports, "default") ? module.exports.default : module.exports

  if (!matchesPlugin(plugin) || (host.process === "window" && !matchesDependencies(plugin)))
    throw new Error("A plugin's ./gui bundle must default-export a `Plugin.define` from `@opencode/plugin/gui`")

  if (plugin.id !== id) throw new Error(`A plugin's GUI must take its server plugin's id "${id}", not "${plugin.id}"`)

  if (!plugin.setup && !plugin.main)
    throw new Error("A plugin's GUI must have a window `setup`, a `main` setup, or both")

  return {
    definition: {
      id,
      os: plugin.os,
      // SAFETY: `matchesPlugin` checked the tokens the host reads, and `is` keeps each token's identity and spec.
      provides: plugin.provides as Declarations["provides"],
      // SAFETY: as above, in a window; main drops them.
      uses: host.process === "window" ? (plugin.uses as Declarations["uses"]) : undefined,
      // SAFETY: as above.
      requires: host.process === "window" ? (plugin.requires as Declarations["requires"]) : undefined,
      // SAFETY: `matchesPlugin` checked each store's scope and schema; `is` keeps the declaration whole.
      stores: plugin.stores as Declarations["stores"],
      i18n: plugin.i18n && { ...plugin.i18n, en: plugin.i18n.en ?? {} },
    },
    // SAFETY: a bundle is plain JavaScript; a function is all the host can check of a setup.
    setup: plugin.setup as PluginBundle["setup"],
    // SAFETY: as above, for the main setup.
    main: plugin.main as PluginBundle["main"],
  }
}

/** The CommonJS module a bundle fills. */
type BundleModule = { exports: object }

// What the host reads of a plugin's GUI, checked once here: a malformed token or store would otherwise throw inside
// the host's shared memos and take every plugin down. Tokens keep their identity: `is` checks without copying.
const Token = Schema.Struct({ kind: Schema.Literals(["contract", "ipc"]), id: Schema.String })

const Tokens = Schema.Record(Schema.String, Token)

const Setup = Schema.declare(Predicate.isFunction)

const matchesDependencies = Schema.is(
  Schema.Struct({ uses: Schema.optional(Tokens), requires: Schema.optional(Tokens) }),
)

const matchesPlugin = Schema.is(
  Schema.Struct({
    id: Schema.String,
    os: Schema.optional(Schema.Array(Schema.Literals(["macos", "windows", "linux"]))),
    provides: Schema.optional(Tokens),
    uses: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    requires: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    stores: Schema.optional(
      Schema.Record(
        Schema.String,
        Schema.Struct({
          scope: Schema.Literals(["global", "session", "main"]),
          schema: Schema.declare(Schema.isSchema),
        }),
      ),
    ),
    // A plugin's catalog ships every locale inline; only built-ins load locales lazily.
    i18n: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String))),
    setup: Schema.optional(Setup),
    main: Schema.optional(Setup),
  }),
)

/**
 * Whether a plugin's GUI may take an id. Built-ins win: a plugin cannot take a built-in's id, an id that nests under
 * one or that one nests under (tokens and stored keys resolve by dot-separated prefix), or the `opencode` namespace.
 * Both hosts check it, each against its own built-ins.
 *
 * @param id - The server plugin's id.
 * @param builtins - The host's built-in definitions, on every OS.
 * @returns True when no built-in claims the id.
 */
export function pluginIdAvailable(id: string, builtins: readonly Pick<Declarations, "id">[]) {
  return [{ id: "opencode" }, ...builtins].every(
    (taken) => id !== taken.id && !id.startsWith(`${taken.id}.`) && !taken.id.startsWith(`${id}.`),
  )
}

/** Where an embed sits in its window, as the renderer measured it. */
export interface BridgeLayout {
  /** The embed should be on screen. */
  readonly visible: boolean
  /** Its box in window pixels; absent while it is not laid out. */
  readonly bounds?: {
    /** Left edge. */
    readonly x: number
    /** Top edge. */
    readonly y: number
    /** Width. */
    readonly width: number
    /** Height. */
    readonly height: number
  }
  /** The window's content size the bounds were measured against. */
  readonly viewport?: {
    /** Content width in window pixels. */
    readonly width: number
    /** Content height in window pixels. */
    readonly height: number
  }
  /** RGBA of the backdrop the rounded corners show. */
  readonly background?: readonly [number, number, number, number]
  /** Radius of the bottom corners. */
  readonly radius?: number
  /** The rounded card's hairline ring, which the corner masks would otherwise paint over. */
  readonly border?: {
    /** RGBA of the ring. */
    readonly color: readonly [number, number, number, number]
    /** Ring width in window pixels. */
    readonly width: number
  }
}

/** A GUI plugin as main lists it: a built-in, or the GUI of a plugin on the desktop app's own server. */
export interface Installed {
  /** The plugin's id. */
  readonly id: string
  /** Ships with the app. */
  readonly builtin: boolean
  /** The user has it enabled. */
  readonly enabled: boolean
  /** Why its main entry failed, if it did. */
  readonly error?: string
}

/**
 * Whether a server plugin's GUI loads: an active plugin with an id, not one of the server's own built-ins, that exports
 * `./gui`. Main lists plugins with it; `pluginIdAvailable` then checks the id against the built-ins.
 *
 * @param plugin - A plugin as the server lists it.
 * @returns True when the plugin's `./gui` bundle should load.
 */
export function shipsPluginGui(plugin: PluginInfo): plugin is PluginInfo & {
  /** The server plugin's id, which its GUI takes. */
  readonly id: string
} {
  return !!plugin.id && plugin.source.type !== "builtin" && plugin.state.status === "active" && !!plugin.features.gui
}

/** A plugin's GUI as main read it from the desktop app's own server: what every window evaluates. */
export interface BridgePluginGui {
  /** The server plugin's id, which its GUI takes. */
  readonly id: string
  /** The bundle's opaque revision; a new one makes a window evaluate the bundle again. */
  readonly revision: string
  /** The bundle's CommonJS code. */
  readonly code: string
  /** The plugin's options from `opencode.json`, its GUI's `ctx.options`. */
  readonly options: PluginOptions
}

/** The plugin GUIs main runs. Main alone lists them; windows load what it sends. */
export interface BridgePluginGuis {
  /** The plugins whose GUI loads on this system, after main's id and OS checks. */
  readonly plugins: readonly BridgePluginGui[]
  /** Plugins whose GUI cannot load because a built-in claims the id; Settings › Plugins reports them. */
  readonly reserved: readonly string[]
}

/**
 * A message main pushes to a window.
 * - `state`: an Ipc's new state for this window.
 * - `event`: an Ipc event.
 * - `available`: an Ipc's provider came or went.
 * - `installed`: the installed list changed.
 * - `pluginGuis`: the plugin GUIs main runs changed.
 * - `menubarItems`: the native menu's plugin items changed.
 */
export type BridgeMessage =
  | {
      /** An Ipc's new state. */
      readonly type: "state"
      /** The Ipc's id. */
      readonly ipc: string
      /** The encoded state. */
      readonly state: unknown
    }
  | {
      /** An Ipc event. */
      readonly type: "event"
      /** The Ipc's id. */
      readonly ipc: string
      /** The event's name. */
      readonly name: string
      /** The encoded data. */
      readonly data: unknown
    }
  | {
      /** An Ipc's provider came or went. */
      readonly type: "available"
      /** The Ipc's id. */
      readonly ipc: string
      /** It is provided now. */
      readonly available: boolean
    }
  | {
      /** The installed list changed. */
      readonly type: "installed"
      /** The new list. */
      readonly list: readonly Installed[]
    }
  | ({
      /** The plugin GUIs main runs changed. */
      readonly type: "pluginGuis"
    } & BridgePluginGuis)
  | {
      /** The native menu's plugin items changed. */
      readonly type: "menubarItems"
      /** The new items. */
      readonly items: readonly BridgeMenubarItem[]
    }

/** A `MenubarItem` as main publishes it to windows that draw their own menu. */
export interface BridgeMenubarItem {
  /** The menu it goes in. */
  readonly menu: string
  /** `${plugin}.${id}`. */
  readonly id: string
  /** The label. */
  readonly label: string
  /** The item it follows. */
  readonly after?: string
  /** The item is enabled now. */
  readonly enabled: boolean
}

/** What the desktop preload exposes to the renderer host; undefined on the web. */
export interface Bridge {
  /** The app runs packaged, as main's `App.packaged` says; the window's `App` reports the same. */
  readonly packaged: boolean
  /**
   * Calls an Ipc method.
   *
   * @param input - The Ipc, the method and the encoded input.
   * @param signal - Aborts the call.
   * @returns The encoded output.
   */
  // SAFETY: the reply is the method's output as its schema encoded it; the renderer host decodes it with that schema.
  /* oxlint-disable anti-slop/no-unknown-returns -- see SAFETY above */
  call(
    input: {
      /** The Ipc's id. */
      readonly ipc: string
      /** The method's name. */
      readonly method: string
      /** The encoded input. */
      readonly input: unknown
    },
    signal?: AbortSignal,
  ): Promise<unknown>
  /* oxlint-enable anti-slop/no-unknown-returns */
  /**
   * Starts state sync for this window. Resolves with the current availability and state.
   *
   * @param ipc - The Ipc's id.
   */
  subscribe(ipc: string): Promise<{
    /** The Ipc is provided. */
    readonly available: boolean
    /** Its encoded state for this window. */
    readonly state?: unknown
  }>
  /**
   * Listens to every message main pushes.
   *
   * @param listener - Receives each message.
   * @returns Removes the listener.
   */
  on(listener: (message: BridgeMessage) => void): () => void
  /**
   * Lays out an embed, or hides it without a layout.
   *
   * @param id - The embed's id.
   * @param layout - Where it goes.
   */
  embed(id: string, layout?: BridgeLayout): void
  /**
   * A JPEG still of an embed.
   *
   * @param id - The embed's id.
   */
  capture(id: string): Promise<Uint8Array | undefined>
  /**
   * Runs a native menubar item from the in-app (Windows) menu.
   *
   * @param id - `${plugin}.${id}`.
   */
  runMenubarItem(id: string): void
  /**
   * Tells main the current server endpoints so `ServerEndpoints.get(id)` can resolve them.
   *
   * @param servers - The window's servers.
   */
  configure(
    servers: readonly {
      /** The server's id. */
      readonly id: string
      /** Its base URL. */
      readonly url: string
      /** The HTTP basic user name. */
      readonly username?: string
      /** The HTTP basic password. */
      readonly password?: string
    }[],
  ): void
  /**
   * The plugin GUIs main runs. Main lists the plugins on the desktop app's own server and reads their `./gui` bundles
   * itself, following that server's `plugin.updated` event; a `pluginGuis` message brings each change after this.
   *
   * @returns The plugins whose GUI loads, and the ids a built-in claims.
   */
  pluginGuis(): Promise<BridgePluginGuis>
  /** The plugin manager. */
  readonly manager: {
    /**
     * Explicit enable-state rows from the existing preload startup reply, including earlier ids. Undefined (or an
     * omitted promise) means unknown: activation waits for `list()` or a live list, never assumes all are enabled.
     * An empty list is authoritative: no saved settings. A rejected promise also falls back to the manager list.
     */
    readonly initial?: Promise<readonly EnableState[] | undefined>
    /** The installed plugins, built-ins included. */
    list(): Promise<readonly Installed[]>
    /**
     * Enables a plugin.
     *
     * @param id - The plugin's id.
     */
    enable(id: string): Promise<void>
    /**
     * Disables a plugin.
     *
     * @param id - The plugin's id.
     */
    disable(id: string): Promise<void>
    /**
     * Reloads a plugin's main entry; a failed reload keeps the last good revision.
     *
     * @param id - The plugin's id.
     */
    reload(id: string): Promise<void>
  }
}
