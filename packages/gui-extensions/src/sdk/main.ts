import type { BrowserWindow, NativeImage, WebContentsView } from "electron"
import type { Schema } from "effect"
import { Host, Point, type Cleanup } from "./core"

export * from "./core"

export interface Windows {
  get(id: number): BrowserWindow | undefined
  list(): readonly BrowserWindow[]
  focused(): BrowserWindow | undefined
  on(event: "open" | "close", handler: (window: BrowserWindow) => void): Cleanup
}

export interface Surface {
  readonly id: string
  /** Page-side gate. The view shows only while the renderer lays it out AND show(true). */
  show(visible: boolean): void
  capture(): Promise<NativeImage | undefined>
  dispose(): void
}

export interface Surfaces {
  /** The renderer presents it with `<Surface id>`; the host owns bounds, zoom, corners, and occlusion. */
  create(view: WebContentsView, window: BrowserWindow): Surface
}

export interface MainStorage {
  /** Values are stored as the schema's canonical JSON; the schema must not need services. */
  store<S extends Schema.ConstraintCodec<unknown, unknown>>(
    key: string,
    options: { readonly schema: S; readonly initial: S["Type"]; readonly from?: string },
  ): { get(): S["Type"]; set(value: S["Type"]): void }
}

export interface MainServer {
  readonly id: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  /** Same machine as this app's own server. Loopback HTTP alone does not qualify. */
  readonly local: boolean
}

export interface Cli {
  readonly version: string
  readonly command: readonly string[]
  readonly binary?: string
  readonly development: boolean
}

export interface MainApp {
  readonly version: string
  readonly channel: string
  readonly packaged: boolean
  server(id: string): MainServer | undefined
  /** Flushes state and marks the app as quitting, then runs handoff (e.g. quitAndInstall) or relaunches. */
  restart(handoff?: () => void | Promise<void>): Promise<void>
}

export interface Menubar {
  readonly menu: "app" | "file" | "edit" | "view" | "go" | "window" | "help"
  readonly id: string
  readonly label: string
  readonly after?: string
  readonly enabled?: () => boolean
  run(window: BrowserWindow | undefined): void
}

export const Windows = Host.define<Windows>("window")
export const Surfaces = Host.define<Surfaces>("surface")
export const MainStorage = Host.define<MainStorage>("storage")
export const Cli = Host.define<Cli>("cli")
export const MainApp = Host.define<MainApp>("app")
export const Menubar = Point.define<Menubar>("menubar")
