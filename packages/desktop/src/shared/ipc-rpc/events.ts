import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { PluginInstalled, PluginMenubarItem, PluginPayload, PluginGuis } from "./plugins"

export class DeepLinksOpened extends Schema.TaggedClass<DeepLinksOpened>()("DeepLinksOpened", {
  urls: Schema.Array(Schema.String),
}) {}

export class MenuCommandTriggered extends Schema.TaggedClass<MenuCommandTriggered>()("MenuCommandTriggered", {
  id: Schema.String,
}) {}

export class WindowFullscreenChanged extends Schema.TaggedClass<WindowFullscreenChanged>()("WindowFullscreenChanged", {
  fullscreen: Schema.Boolean,
}) {}

export class WindowPinchZoomChanged extends Schema.TaggedClass<WindowPinchZoomChanged>()("WindowPinchZoomChanged", {
  enabled: Schema.Boolean,
}) {}

export class WindowZoomChanged extends Schema.TaggedClass<WindowZoomChanged>()("WindowZoomChanged", {
  factor: Schema.Number,
}) {}

// Another window wrote to a storage namespace; recipients refresh their in-memory copy.
export class StorageChanged extends Schema.TaggedClass<StorageChanged>()("StorageChanged", {
  name: Schema.String,
  insert: Schema.Record(Schema.String, Schema.String),
  remove: Schema.Array(Schema.String),
  revision: Schema.Number,
}) {}

// A main plugin's Ipc state for this window, already encoded with the Ipc's schema.
export class PluginState extends Schema.TaggedClass<PluginState>()("PluginState", {
  ipc: Schema.String,
  state: PluginPayload,
}) {}

export class PluginEvent extends Schema.TaggedClass<PluginEvent>()("PluginEvent", {
  ipc: Schema.String,
  name: Schema.String,
  data: PluginPayload,
}) {}

export class PluginAvailable extends Schema.TaggedClass<PluginAvailable>()("PluginAvailable", {
  ipc: Schema.String,
  available: Schema.Boolean,
}) {}

export class PluginsChanged extends Schema.TaggedClass<PluginsChanged>()("PluginsChanged", {
  list: Schema.Array(PluginInstalled),
}) {}

// The plugin GUIs main lists from the app's own server changed; windows load the new set.
export class PluginGuisChanged extends Schema.TaggedClass<PluginGuisChanged>()(
  "PluginGuisChanged",
  PluginGuis.fields,
) {}

export class PluginMenubarItemsChanged extends Schema.TaggedClass<PluginMenubarItemsChanged>()(
  "PluginMenubarItemsChanged",
  { items: Schema.Array(PluginMenubarItem) },
) {}

export const DesktopEvent = Schema.Union([
  DeepLinksOpened,
  MenuCommandTriggered,
  WindowFullscreenChanged,
  WindowPinchZoomChanged,
  WindowZoomChanged,
  StorageChanged,
  PluginState,
  PluginEvent,
  PluginAvailable,
  PluginsChanged,
  PluginGuisChanged,
  PluginMenubarItemsChanged,
])

export type DesktopEvent = Schema.Schema.Type<typeof DesktopEvent>

export const DesktopEvents = Rpc.make("DesktopEvents", { success: DesktopEvent, stream: true })

export const EventRpcs = RpcGroup.make(DesktopEvents)
