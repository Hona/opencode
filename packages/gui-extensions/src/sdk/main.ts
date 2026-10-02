import type { BrowserWindow, NativeImage, WebContentsView } from "electron"
import type { Schema } from "effect"
import {
  Point,
  type BaseContext,
  type Build,
  type Cleanup,
  type Ipc,
  type IpcImpl,
  type IpcProvider,
  type IpcSpec,
  type Persisted,
} from "./core"
import type { Scope } from "./scope"

export * from "./core"

export * from "./scope"

export interface Windows {
  get(id: number): BrowserWindow | undefined
  list(): readonly BrowserWindow[]
  focused(): BrowserWindow | undefined
  on(event: "open" | "close", handler: (window: BrowserWindow) => void): Cleanup
}

export interface Embed {
  readonly id: string
  /** Page-side gate. The view shows only while the renderer lays it out AND show(true). */
  show(visible: boolean): void
  /** Runs when the view goes on or off screen, including when the renderer paints a still in its place. */
  on(event: "visible", handler: (visible: boolean) => void): Cleanup
  capture(): Promise<NativeImage | undefined>
  dispose(): void
}

export interface Embeds {
  /** The renderer presents it with the renderer SDK's `Embeds.View`; the host owns bounds, zoom, corners, and occlusion. */
  create(view: WebContentsView, window: BrowserWindow): Embed
}

export interface Storage {
  /**
   * The window's `Persisted` shape, read and written synchronously: `value` is always defined and `ready()` always
   * true. Values are stored as the schema's canonical JSON; the schema must not need services. Each write reaches the
   * database before it returns. `update` changes a copy of the value; a mutation may also return the next value, which
   * replaces it, so a number, `null` or a new list is written that way.
   */
  store<S extends Schema.ConstraintCodec<unknown, unknown>>(
    key: string,
    options: { readonly schema: S; readonly initial: S["Type"]; readonly from?: string },
  ): Persisted<S["Type"], S["Type"]>
  /** Deletes the value and the older copy `from` names, so the key reads as its `initial` again. */
  remove(key: string, options?: { readonly from?: string }): void
}

export interface ServerEndpoint {
  readonly id: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  /** Same machine as this app's own server. Loopback HTTP alone does not qualify. */
  readonly local: boolean
  /** Credentials a window configured for the server; `headers` already carries them. None for the app's own server. */
  readonly username?: string
  readonly password?: string
}

export interface Cli {
  readonly version: string
  readonly command: readonly string[]
  readonly binary?: string
  readonly development: boolean
}

/** The server endpoints the app's windows use. */
export interface ServerEndpoints {
  get(id: string): ServerEndpoint | undefined
}

/** The app process's lifetime. */
export interface Lifecycle {
  /**
   * Marks the app as quitting and disposes every extension but the one whose `keep` scope is passed (the caller's
   * `ctx.scope` by default), then runs handoff (e.g. quitAndInstall) or relaunches. The kept scope outlives shutdown
   * until the handoff settles, and keeps running when it fails (the promise rejects). Only an extension's `ctx.scope`
   * can be kept.
   */
  restart(handoff?: () => void | Promise<void>, options?: { readonly keep?: Scope }): Promise<void>
}

/** The desktop log file. */
export interface Log {
  /** Writes to the desktop log file (included in exported debug logs); each field of `data` is serialized as it is. */
  write<Data extends Readonly<Record<string, unknown>>>(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    data?: Data,
  ): void
}

/**
 * The setup context in the main process. The APIs the host always provides are properties, each created on first
 * read.
 */
export interface MainContext extends BaseContext {
  /**
   * The instance's lifetime. `signal` aborts when the extension is disabled, reloaded, or the app quits;
   * `addFinalizer` adds its teardown, and runs it at once when the instance is already gone.
   */
  readonly scope: Scope
  readonly storage: Storage
  readonly log: Log
  readonly lifecycle: Lifecycle
  readonly build: Build
  readonly serverEndpoints: ServerEndpoints
  readonly windows: Windows
  readonly embeds: Embeds
  readonly cli: Cli
  /** Provides an Ipc the definition declares in `provides`, for the windows to use. */
  provide<S extends IpcSpec>(token: Ipc<S>, impl: IpcImpl<S>): IpcProvider<S>
}

/** A main-process entry. */
export type MainSetup = (ctx: MainContext) => void | Promise<void>

export interface MenubarItem {
  readonly menu: "app" | "file" | "edit" | "view" | "go" | "window" | "help"
  readonly id: string
  readonly label: string
  readonly after?: string
  readonly enabled?: () => boolean
  run(window: BrowserWindow | undefined): void
}

export const MenubarItem = Point.define<MenubarItem>("menubar-item")
