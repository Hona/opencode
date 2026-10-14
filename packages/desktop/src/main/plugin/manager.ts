import { pluginEnabled } from "@opencode/plugin/gui/host"
import type { Database } from "../storage/database"
import { plugin } from "../storage/schema"
import { readEnableState } from "./enable-state"

/** Plugin enable state in the desktop database, for built-ins and plugin GUI plugins alike. */
export function createManager(db: Database) {
  return {
    /** The setting saved under the id; no setting means enabled. */
    enabled(id: string) {
      return pluginEnabled(id, readEnableState(db.$client))
    },
    setEnabled(id: string, enabled: boolean) {
      db.insert(plugin).values({ id, enabled }).onConflictDoUpdate({ target: plugin.id, set: { enabled } }).run()
    },
  }
}
