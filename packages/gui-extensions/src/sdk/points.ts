import type { IconProps } from "@opencode/ui/icon"
import type { Accessor, JSX } from "solid-js"
import { Point } from "./core"
import type { SessionRef, SessionView } from "./services"

export type IconName = IconProps["name"]

export interface Command {
  /** Local id. The host publishes `${extension}.${id}`, e.g. terminal + toggle = terminal.toggle. */
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly group?: string
  readonly bind?: string
  readonly slash?: { readonly name: string; readonly arguments?: true }
  /** Keep out of the command palette. */
  readonly hidden?: true
  readonly suggested?: boolean
  readonly enabled?: boolean
  /** CSS selector the keyboard focus must be inside for the binding to apply. */
  readonly scope?: string
  /** The binding also fires while a text field has focus. */
  readonly editable?: true
  run(input?: string): void | Promise<void>
}

export interface Menu {
  /** Host menu: "session.panel" (the + before side panel tabs), "server.add", "server.row". */
  readonly menu: "session.panel" | "server.add" | "server.row"
  readonly id: string
  readonly title: string
  readonly icon?: IconName
  /** Published command id whose shortcut the item shows. */
  readonly keybind?: string
  readonly order?: number
  /** Receives the row input, e.g. a server key for "server.row". */
  readonly when?: (input: string) => boolean
  run(input: string): void
}

export interface PanelTab {
  /** Host key is `${extension}:${id}`. */
  readonly id: string
  /** Accessible name. Also the trigger content when `label` is absent. */
  readonly title: string
  readonly label?: (state: { readonly active: boolean }) => JSX.Element
  /**
   * - `pinned`: listed without being opened, before every other tab, never closed or dragged.
   * - `fixed`: not draggable; compact close button.
   * - `launcher`: not draggable; the close button shows on hover or while selected.
   */
  readonly kind?: "pinned" | "fixed" | "launcher"
  /** Renders before the tabs in stored order. */
  readonly first?: boolean
  /** Selected when the stored selection is gone. The highest value wins, then strip order. */
  readonly fallback?: number
  /** Replaced by the next preview; double-click promotes it. */
  readonly preview?: boolean
  /** Tabs in one group share one render that stays mounted while any member is listed. */
  readonly group?: string
  /** Struck through, e.g. a file that no longer exists. */
  readonly missing?: boolean
  /** The tab panel itself joins the tab order, for content without focusable elements. */
  readonly tabbable?: boolean
  /** Forces the panel's inner sidebar open and disables its toggle. */
  readonly sidebar?: "locked"
  /** Stable DOM ids for the trigger and the tab panel. */
  readonly dom?: { readonly tab?: string; readonly panel?: string }
}

export interface MobileView {
  readonly title: string
  readonly order: number
  /** `view` replaces the conversation; `menu` and `drawer` live behind the overflow menu. */
  readonly kind: "tab" | "menu" | "drawer"
}

export interface Panel {
  readonly id: string
  readonly region: "side" | "dock"
  /** Asks for the wider session minimum while the side region is open. Reactive. */
  readonly wide?: boolean
  /** Stored tab keys from before extensions, mapped to this panel's tab ids. The host rewrites them once. */
  readonly legacy?: Readonly<Record<string, string>>
  /** A narrow-screen view of this panel. The render sees `usePanel().placement() === "mobile"`. */
  readonly mobile?: MobileView
  /**
   * Reactive. `open` holds this extension's tab ids stored in the strip. List those that still apply,
   * plus any `pinned` tab. The host renders triggers, restore, and selection from this data.
   */
  list(session: SessionView, open: readonly string[]): readonly PanelTab[]
  render(tab: Accessor<PanelTab>, session: SessionView): JSX.Element
  /** Runs after the host removes the tab from the strip. */
  close?(tab: PanelTab, session: SessionView): void
  /** Runs when the tab becomes selected. */
  focus?(tab: PanelTab, session: SessionView): void
}

export interface SettingEntry {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly keywords?: string
}

export interface Setting {
  readonly id: string
  /** Adds a section to a host page. Omit to add a page. */
  readonly page?: "general" | "servers"
  readonly title: string
  readonly icon?: IconName
  readonly available?: "desktop" | "mobile"
  /** Search metadata, indexed without mounting the page. */
  readonly entries?: readonly SettingEntry[]
  render(input: { readonly target?: string }): JSX.Element
}

export type ServerState = "stopped" | "starting" | "auth" | "ready" | "failed"

export interface ServerEntry {
  readonly id: string
  readonly name: string
  readonly state: ServerState
  readonly http?: { readonly url: string; readonly username?: string; readonly password?: string }
  reconnect?(signal: AbortSignal): Promise<{ readonly url: string; readonly password?: string }>
  /** Called before opening a server that is not ready. Resolves true once it is. */
  connect?(): Promise<boolean>
}

export interface Server {
  /** Startup waits until every source is ready. */
  readonly ready: boolean
  /** Keys are `${extension}:${id}`. */
  readonly entries: readonly ServerEntry[]
}

export interface Link {
  readonly href: string
  /** The extension that produced the linked item, e.g. the origin of a composer comment. */
  readonly origin?: string
  /** The path is a known workspace file (e.g. a palette result), not a guess from text. */
  readonly exact?: boolean
  /** Workspace-relative directory the link was written in. */
  readonly base?: string
  readonly session?: SessionRef
}

export interface LinkHandler {
  readonly priority?: number
  match(link: Link): boolean
  open(link: Link): void
}

export interface Status {
  readonly id: string
  /** 	itlebar (default) places a pill in the titlebar or tabs footer; channel makes the dev channel badge a toggle. */
  readonly placement?: "titlebar" | "channel"
  readonly label: string
  readonly title?: string
  readonly icon?: IconName
  readonly busy?: boolean
  readonly pressed?: boolean
  run(): void
}

export interface SlotMap {
  readonly app: Record<string, never>
  /** Full-width strip under the shell content, above toasts. */
  readonly "shell.bottom": Record<string, never>
  /** The timeline title row. Cached timelines stay mounted while hidden; `active` is false then. */
  readonly "session.header": { readonly session: SessionView; readonly active: boolean }
  readonly "session.panel.end": { readonly session: SessionView }
  readonly "session.panel.sidebar": { readonly session: SessionView }
}

export type Slot = {
  [At in keyof SlotMap]: { readonly at: At; readonly order?: number; render(input: SlotMap[At]): JSX.Element }
}[keyof SlotMap]

export const Command = Point.define<Command>("command")
export const Menu = Point.define<Menu>("menu")
export const Panel = Point.define<Panel>("panel")
export const Setting = Point.define<Setting>("setting")
export const Server = Point.define<Server>("server")
export const Link = Point.define<LinkHandler>("link")
export const Status = Point.define<Status>("status")
export const Slot = Point.define<Slot>("slot")
export const Style = Point.define<string>("style")
