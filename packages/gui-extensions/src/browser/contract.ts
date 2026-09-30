import { Service, type SessionRef } from "../sdk"

export interface Browser {
  /** The desktop browser pane exists for this session (the session is attached to a pane). */
  attached(session: SessionRef): boolean
  /** A workspace file (relative path) or http(s) URL can open in the pane for this session. */
  canOpen(session: SessionRef, path?: string): boolean
  /** Opens a URL (http(s) or file://) as a browser tab in the session's side panel. */
  open(session: SessionRef, url: string): void
}

/** Provided by the browser extension on desktop. Undefined on web or while the extension is off. */
export const Browser = Service.define<Browser>("browser")
