import type { Data } from "@opencode/client/solid"
import type { LocationRef, OpenCodeClient, ProjectListOutput, WorktreeDirectory } from "@opencode/client/promise"
import type { Schema } from "effect"
import type { Accessor, JSX } from "solid-js"
import type { Store } from "solid-js/store"
import { Host, type Cleanup, type OS } from "./core"
import type { Link } from "./points"

export interface ServerRef {
  /** Host key: "sidecar", an http URL, or `${extension}:${id}` for servers an extension contributes. */
  readonly id: string
  readonly url: string
  readonly password?: string
  readonly client: OpenCodeClient
  readonly data: Data
  /** The built-in local server or a loopback http server. */
  readonly local: boolean
  readonly builtin: boolean
  readonly compatible: boolean
}

/** A session owned by an open shell tab, mounted or not. */
export interface SessionRef {
  readonly key: string
  readonly id: string
  readonly tab: string
  readonly server: ServerRef
  readonly pending: boolean
  readonly location: LocationRef | undefined
}

export type Project = Omit<ProjectListOutput[number], "canonical"> & {
  worktree: string
  worktrees: WorktreeDirectory[]
}

export type FileContent = {
  type: "text" | "binary"
  content: string
  diff?: string
  patch?: {
    oldFileName: string
    newFileName: string
    oldHeader?: string
    newHeader?: string
    hunks: Array<{ oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }>
    index?: string
  }
  encoding?: "base64"
  mimeType?: string
  /** On-disk size when the bytes themselves are not retained. */
  size?: number
}

export interface LineRange {
  start: number
  end: number
  side?: "additions" | "deletions"
  endSide?: "additions" | "deletions"
}

export interface FileState {
  path: string
  name: string
  loaded?: boolean
  loading?: boolean
  notFound?: boolean
  error?: string
  content?: FileContent
}

export interface FileNode {
  name: string
  path: string
  absolute: string
  type: "file" | "directory"
  ignored: boolean
}

export interface Files {
  readonly root: string
  ready(): boolean
  resolve(path: string): string
  absolute(path: string): boolean
  get(path: string): FileState | undefined
  sync(path: string, options?: { readonly force?: boolean }): Promise<void>
  search(
    query: string,
    options?: { readonly kind?: "file" | "any"; readonly limit?: number; readonly signal?: AbortSignal },
  ): Promise<string[]>
  readonly selection: {
    get(path: string): LineRange | null | undefined
    set(path: string, range: LineRange | null): void
  }
  readonly scroll: {
    get(path: string): { readonly top?: number; readonly left?: number }
    set(path: string, value: { readonly top?: number; readonly left?: number }): void
  }
  readonly tree: {
    list(path: string): readonly FileNode[]
    state(path: string): { expanded: boolean; loaded?: boolean; loading?: boolean; error?: string } | undefined
    sync(path: string, options?: { readonly force?: boolean }): Promise<void>
    expand(path: string, options?: { readonly list?: boolean }): void
    collapse(path: string): void
  }
}

export interface Comment {
  id: string
  time: number
  file: string
  selection: LineRange
  comment: string
}

export interface Comments {
  list(file?: string): readonly Comment[]
  add(input: Omit<Comment, "id" | "time">): Comment
  update(id: string, comment: string): void
  remove(id: string): void
  readonly focus: {
    current(): { readonly file: string; readonly id: string } | null
    set(value: { readonly file: string; readonly id: string } | null): void
  }
  readonly active: {
    current(): { readonly file: string; readonly id: string } | null
    set(value: { readonly file: string; readonly id: string } | null): void
  }
}

export interface ComposerFile {
  type: "file"
  path: string
  selection?: { startLine: number; endLine: number; startChar: number; endChar: number }
  preview?: string
  comment?: string
  commentID?: string
  commentOrigin?: "review" | "file"
}

export interface Composer {
  attach(part: ComposerFile): void
  /** id is the part's commentID. */
  update(id: string, patch: { readonly comment?: string; readonly preview?: string }): void
  detach(id: string): void
}

/** A mounted session route. Slot inputs and panel renders receive this. */
export interface SessionView extends SessionRef {
  readonly project: Project | undefined
  readonly directory: string
  readonly file: Files
  readonly comment: Comments
  readonly composer: Composer
}

export interface Sessions {
  /** Sessions owned by open shell tabs. Reactive. */
  list(): readonly SessionRef[]
  /** The routed, mounted session. Reactive. */
  current(): SessionView | undefined
}

export type PanelState = "closed" | "open" | "active" | "visible"

export interface Layout {
  /** Viewport under 768px. */
  narrow(): boolean
  /** Panel keys are `${extension}:${tab id}`. Works for sessions that are not mounted. */
  open(key: string, session: SessionRef, options?: { readonly preview?: boolean; readonly focus?: boolean }): void
  close(key: string, session: SessionRef): void
  /** Closing the last panel the side region was opened for also closes the region. */
  toggle(key: string, session: SessionRef): void
  state(key: string, session: SessionRef): PanelState
  readonly side: { opened(session: SessionRef): boolean; toggle(session: SessionRef): void }
  readonly dock: { opened(session: SessionRef): boolean; placement(): "side" | "bottom" }
  readonly scroll: {
    get(session: SessionRef, key: string): { readonly x: number; readonly y: number } | undefined
    set(session: SessionRef, key: string, value: { readonly x: number; readonly y: number }): void
  }
  settings(page?: string): void
}

export type StorageScope = "app" | { readonly server: string; readonly directory?: string } | { readonly session: SessionRef }

export interface Storage {
  /** Durable, schema-decoded, synced across windows. */
  store<S extends Schema.ConstraintCodec<object, unknown>>(
    key: string,
    options: {
      readonly schema: S
      readonly initial: S["Type"]
      readonly scope?: StorageScope
      /**
       * Imports an older host key of the same storage once (the raw stored key, e.g. "workspace:terminal").
       * With pick, only the picked part of the old JSON is copied and the old key stays for its other owners.
       */
      readonly from?: string | { readonly key: string; pick(value: unknown): unknown }
    },
  ): readonly [Store<S["Type"]>, (mutation: (draft: S["Type"]) => void) => void, Accessor<boolean>]
  /** Window-local and kept across extension reloads. */
  memory<T extends object>(
    key: string,
    options: { readonly initial: T },
  ): readonly [Store<T>, (mutation: (draft: T) => void) => void]
  remove(key: string, options?: { readonly scope?: StorageScope }): void
}

export interface System {
  copy(text: string): Promise<void>
  save(file: { readonly name: string; readonly content: string }): Promise<boolean>
  open(url: string): void
}

export interface Native {
  readonly os: OS
  readonly window: string
  zoom(): number
  launch(path: string, app?: string): Promise<void>
  reveal(path: string): Promise<boolean>
  installed(app: string): Promise<boolean>
}

export interface App {
  readonly version?: string
  readonly channel: "local" | "dev" | "beta" | "prod"
  readonly platform: "web" | "desktop"
  font(kind: "mono"): string
  on(event: "workspace.remove", handler: (value: { readonly server: string; readonly directory: string }) => void): Cleanup
}

export interface Links {
  /** Routes a local link to the best Link handler. Returns false when none matches. */
  open(link: Link): boolean
}

export interface Dialogs {
  show(render: () => JSX.Element): void
  close(): void
}

export const Sessions = Host.define<Sessions>("session")
export const Layout = Host.define<Layout>("layout")
export const Storage = Host.define<Storage>("storage")
export const System = Host.define<System>("system")
export const Native = Host.define<Native | undefined>("native")
export const App = Host.define<App>("app")
export const Dialogs = Host.define<Dialogs>("dialog")
export const Links = Host.define<Links>("link")
