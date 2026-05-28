import sessionProjectors from "../session/projectors"
import { SyncEvent } from "@/sync"
import { Session } from "@/session/session"
import { SessionTable } from "@/session/session.sql"
import { Database } from "@/storage/db"
import { eq } from "drizzle-orm"

export function initProjectors() {
  SyncEvent.init({
    projectors: sessionProjectors,
    convertEvent: (type, data) => {
      if (type === "session.updated") {
        const id = (data as SyncEvent.Event<typeof Session.Event.Updated>["data"]).sessionID
        const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())

        if (!row) return data

        return {
          sessionID: id,
          info: Session.fromRow(row),
        }
      }
      return data
    },
    persistEvent: (type, data) => {
      if (type === Session.Event.Created.type || type === Session.Event.Deleted.type) {
        const payload = data as SyncEvent.Event<typeof Session.Event.Created>["data"]
        return { ...payload, info: Session.toStorageEventInfo(payload.info as Session.Info) }
      }
      if (type === Session.Event.Updated.type) {
        const payload = data as SyncEvent.Event<typeof Session.Event.Updated>["data"]
        return { ...payload, info: Session.toStorageEventPatch(payload.info as Session.Patch) }
      }
      return data
    },
  })
}
