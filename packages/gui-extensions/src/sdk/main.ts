import type { BrowserWindow, NativeImage, WebContentsView } from "electron"
import type { Schema } from "effect"
import { HostApi, Point, type Cleanup } from "./core"
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
  /** Values are stored as the schema's canonical JSON; the schema must not need services. */
  store<S extends Schema.ConstraintCodec<unknown, unknown>>(
    key: string,
    options: { readonly schema: S; readonly initial: S["Type"]; readonly from?: string },
  ): {
    get(): S["Type"]
    set(value: S["Type"]): void
    /** Deletes the value and the older copy `from` names, so the key reads as `initial` again. */
    remove(): void
  }
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

/** The running build. */
export interface Build {
  readonly version: string
  readonly channel: string
  readonly packaged: boolean
}

/** The server endpoints the app's windows use. */
export interface Servers {
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

export interface MenubarItem {
  readonly menu: "app" | "file" | "edit" | "view" | "go" | "window" | "help"
  readonly id: string
  readonly label: string
  readonly after?: string
  readonly enabled?: () => boolean
  run(window: BrowserWindow | undefined): void
}

export const Windows = HostApi.define<Windows>("window")

export const Embeds = HostApi.define<Embeds>("embed")

export const Storage = HostApi.define<Storage>("storage")

export const Cli = HostApi.define<Cli>("cli")

export const Build = HostApi.define<Build>("build")

export const Servers = HostApi.define<Servers>("servers")

export const Lifecycle = HostApi.define<Lifecycle>("lifecycle")

export const Log = HostApi.define<Log>("log")

export const MenubarItem = Point.define<MenubarItem>("menubar-item")
