import { createContext, createEffect, createRoot, useContext, type Accessor } from "solid-js"
import type { Sessions } from "./services"
import type { Context } from "./core"

/** The host provides this around every contribution it renders. */
export const ExtensionContext = createContext<Context>()

export function useExtension() {
  const context = useContext(ExtensionContext)
  if (!context) throw new Error("useExtension must run inside an extension contribution")
  return context
}

export interface PanelSidebar {
  opened(): boolean
  width(): number
  /** False until the stored width loads, so the first layout does not animate. */
  transition(): boolean
  resize(width: number): void
  toggle(): void
}

export interface PanelFrame {
  /** Region open and this tab selected. */
  readonly visible: Accessor<boolean>
  /** Kept on screen while the region animates closed. */
  readonly present: Accessor<boolean>
  readonly placement: Accessor<"side" | "bottom" | "mobile">
  /** Leave room at the end of a header for the host's region toggle. */
  readonly reserve: Accessor<boolean>
  /** Plays size animations; false while the user drags a region edge. */
  readonly animate: Accessor<boolean>
  /** One inner sidebar preference shared by every side panel, toggled from the tab strip. */
  readonly sidebar: PanelSidebar
  /** This extension's tab ids stored in the session's side strip (the ids `list` receives as `open`). */
  readonly open: Accessor<readonly string[]>
}

/** The host provides this around panel renders. */
export const PanelContext = createContext<PanelFrame>()

export function usePanel() {
  const frame = useContext(PanelContext)
  if (!frame) throw new Error("usePanel must run inside a panel render")
  return frame
}

/** Runs fn when the main thread is idle (a short timeout where requestIdleCallback is missing, e.g. Safari). Returns a cancel. */
export function onIdle(fn: () => void) {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(fn)
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(fn, 200)
  return () => clearTimeout(id)
}

/**
 * Loads lazy chunks once the first session route mounts and the main thread is idle: the code v2 bundled
 * with the session screen, so a panel's first open renders at once without adding to app start.
 */
export function preload(sessions: Sessions, load: () => void) {
  return createRoot((dispose) => {
    const state = { cancel: undefined as (() => void) | undefined }
    createEffect(() => {
      if (state.cancel || !sessions.current()) return
      state.cancel = onIdle(load)
    })
    return () => {
      state.cancel?.()
      dispose()
    }
  })
}
