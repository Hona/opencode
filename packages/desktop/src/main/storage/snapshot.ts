import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { eq } from "drizzle-orm"
import { app, ipcMain } from "electron"
import { Option, Schema } from "effect"
import { StorageSnapshotChannel } from "../../shared/ipc-transport"
import type { WindowSnapshot } from "../../shared/window-snapshot"
import { isRendererUrl } from "../windows/scheme"
import { openDatabase } from "./database"
import { extension, state } from "./schema"

// A window's preload asks for the namespaces its shell reads before the page runs, so the first
// render is the hydrated one. Until the storage layer is up (the first window asks before it exists)
// the answer comes from the database file; the layer takes over so later windows see queued writes.
type Provider = (names: ReadonlyArray<string>) => WindowSnapshot

let provider: Provider = readFromDisk

export function setStorageSnapshotProvider(next: Provider) {
  provider = next
}

export function registerStorageSnapshotHandler() {
  // SAFETY: Electron delivers untrusted IPC arguments; decode names once at this boundary.
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- see SAFETY above
  ipcMain.handle(StorageSnapshotChannel, (event, names: unknown): WindowSnapshot => {
    if (!isRendererUrl(event.senderFrame?.url)) return { storage: {}, disabledExtensions: [] }

    const decoded = Schema.decodeUnknownOption(Schema.Array(Schema.String))(names)

    if (Option.isNone(decoded)) return { storage: {}, disabledExtensions: [] }

    return provider(decoded.value)
  })
}

// Nothing has been written in this process yet, so every namespace is at revision 0, as the
// storage layer would report before its first update. Legacy electron-store files still waiting
// to be imported would make the database stale for this launch, so the renderer asks the layer then.
function readFromDisk(names: ReadonlyArray<string>): WindowSnapshot {
  const userData = app.getPath("userData")
  const file = path.join(userData, "drafts.sqlite")

  if (!existsSync(file)) return { storage: {}, disabledExtensions: [] }

  const legacy = readdirSync(userData).some((name) => name === "default.dat" || /^opencode\..+\.dat$/.test(name))

  try {
    // Apply the journal before reading enable state, including renamed built-ins, even for the early window.
    const database = openDatabase(file)

    try {
      return {
        storage: legacy
          ? {}
          : Object.fromEntries(
              names.map((name) => [
                name,
                {
                  items: Object.fromEntries(
                    database.db
                      .select({ key: state.key, value: state.value })
                      .from(state)
                      .where(eq(state.name, name))
                      .all()
                      .map((row) => [row.key, row.value]),
                  ),
                  revision: 0,
                },
              ]),
            ),
        disabledExtensions: database.db
          .select({ id: extension.id })
          .from(extension)
          .where(eq(extension.enabled, false))
          .all()
          .map((row) => row.id),
      }
    } finally {
      database.close()
    }
  } catch {
    return { storage: {}, disabledExtensions: [] }
  }
}
