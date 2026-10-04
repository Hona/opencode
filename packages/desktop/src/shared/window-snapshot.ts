import type { StorageSnapshot } from "./ipc-transport"

/** The preload's existing startup reply, before the renderer's RPC port is ready. */
export type WindowSnapshot = { storage: StorageSnapshot; disabledExtensions: readonly string[] }
