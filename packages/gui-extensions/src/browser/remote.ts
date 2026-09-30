import { Browser } from "@opencode/plugin-browser/rpc"
import { Schema } from "effect"
import { Remote } from "../sdk"

const text = (maximum: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maximum))
const binding = text(128)

export const PaneEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("focus"), tabID: Browser.TabID }),
  Schema.Struct({ type: Schema.Literal("preview"), path: text(2_048) }),
  Schema.Struct({
    type: Schema.Literal("state"),
    state: Schema.NullOr(Browser.State),
    error: Schema.optionalKey(Schema.String),
  }),
  // A tab's page exists; the renderer lays it out through this host surface.
  Schema.Struct({ type: Schema.Literal("surface"), tabID: Browser.TabID, surface: text(256) }),
])
export type PaneEvent = typeof PaneEvent.Type

/**
 * The native browser pane in the main process. A binding is one registration of a session's pane
 * by a window; its events go to that window only.
 */
export const BrowserPane = Remote.define({
  id: "browser.pane",
  methods: {
    register: {
      input: Schema.Struct({
        binding,
        server: text(16_384),
        session: text(256).check(Schema.isStartsWith("ses")),
        restore: Schema.optionalKey(Browser.State),
      }),
    },
    // Creates the page of a restored tab the first time the pane shows it.
    load: { input: Schema.Struct({ binding, tabID: Browser.TabID }) },
    command: { input: Schema.Struct({ binding, command: Browser.Action }) },
    close: { input: Schema.Struct({ binding }) },
  },
  events: {
    event: Schema.Struct({ binding: Schema.String, event: PaneEvent }),
  },
})
