import { createHash } from "node:crypto"
import { eq } from "drizzle-orm"
import type { Database } from "./database"
import { blobs, document } from "./schema"
import { createWriteBehind } from "./write-behind"

export type DraftStore = ReturnType<typeof createDraftStore>

export function createDraftStore(db: Database, input: { delay?: number; onError?: (error: unknown) => void } = {}) {
  collectBlobs(db)
  const writer = createWriteBehind<string | null>({
    delay: input.delay ?? 500,
    onError: input.onError,
    write: (batch) =>
      db.transaction((tx) => {
        for (const [key, value] of batch) {
          if (value === null) {
            tx.delete(document).where(eq(document.key, key)).run()
            continue
          }
          tx.insert(document).values({ key, value }).onConflictDoUpdate({ target: document.key, set: { value } }).run()
        }
      }),
  })

  return {
    get(key: string) {
      if (writer.has(key)) return writer.get(key) ?? null
      return db.select({ value: document.value }).from(document).where(eq(document.key, key)).get()?.value ?? null
    },
    set: (key: string, value: string | null) => writer.set(key, value),
    putBlob(data: Uint8Array) {
      const id = createHash("sha256").update(data).digest("hex")
      db.insert(blobs)
        .values({ id, data: Buffer.from(data) })
        .onConflictDoNothing()
        .run()
      return id
    },
    getBlob(id: string): Uint8Array | null {
      return db.select({ data: blobs.data }).from(blobs).where(eq(blobs.id, id)).get()?.data ?? null
    },
    flush: writer.flush,
    close: writer.close,
  }
}

// Blobs are content-addressed and shared; drop the ones no document references anymore.
function collectBlobs(db: Database) {
  const used = new Set<string>()
  db.select({ value: document.value })
    .from(document)
    .all()
    .forEach((row) =>
      JSON.parse(row.value, (_key, item) => {
        if (item?.blob && typeof item.blob.id === "string") used.add(item.blob.id)
        return item
      }),
    )
  db.select({ id: blobs.id })
    .from(blobs)
    .all()
    .filter((row) => !used.has(row.id))
    .forEach((row) => db.delete(blobs).where(eq(blobs.id, row.id)).run())
}
