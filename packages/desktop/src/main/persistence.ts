import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

const STORE_MIGRATION = "electron-store-v1"

export type DesktopPersistence = ReturnType<typeof openDesktopPersistence>

export function openDesktopPersistence(path: string) {
  const database = new DatabaseSync(path)
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS document (
      storage TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (storage, key)
    );

    CREATE TABLE IF NOT EXISTS blob (
      digest TEXT PRIMARY KEY,
      bytes BLOB NOT NULL,
      byte_length INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS migration (
      name TEXT PRIMARY KEY,
      completed_at INTEGER NOT NULL
    );
  `)

  const readDocument = database.prepare("SELECT value FROM document WHERE storage = ? AND key = ?")
  const commitDocument = database.prepare(`
    INSERT INTO document (storage, key, value, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (storage, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `)
  const removeDocument = database.prepare("DELETE FROM document WHERE storage = ? AND key = ?")
  const insertBlob = database.prepare(`
    INSERT OR IGNORE INTO blob (digest, bytes, byte_length, created_at)
    VALUES (?, ?, ?, ?)
  `)
  const selectBlob = database.prepare("SELECT bytes, byte_length FROM blob WHERE digest = ?")
  const selectMigration = database.prepare("SELECT 1 AS found FROM migration WHERE name = ?")
  const insertMigration = database.prepare("INSERT INTO migration (name, completed_at) VALUES (?, ?)")
  const importDocument = database.prepare(`
    INSERT OR IGNORE INTO document (storage, key, value, updated_at)
    VALUES (?, ?, ?, ?)
  `)

  const readBlob = (digest: string, byteLength?: number) => {
    const row = selectBlob.get(digest) as { bytes: Uint8Array; byte_length: number } | undefined
    if (!row) return null
    const bytes = new Uint8Array(row.bytes)
    if (byteLength !== undefined && row.byte_length !== byteLength) {
      throw new Error(`Blob reference mismatch: ${digest}`)
    }
    if (bytes.byteLength !== row.byte_length) throw new Error(`Blob length mismatch: ${digest}`)
    if (sha256(bytes) !== digest) throw new Error(`Blob digest mismatch: ${digest}`)
    return bytes
  }

  return {
    read(storage: string, key: string) {
      const row = readDocument.get(storage, key) as { value: string } | undefined
      return row?.value ?? null
    },
    commit(storage: string, key: string, value: string) {
      commitDocument.run(storage, key, value, Date.now())
    },
    remove(storage: string, key: string) {
      removeDocument.run(storage, key)
    },
    putBlob(bytes: Uint8Array) {
      const value = new Uint8Array(bytes)
      const digest = sha256(value)
      insertBlob.run(digest, value, value.byteLength, Date.now())
      readBlob(digest, value.byteLength)
      return { digest, byteLength: value.byteLength }
    },
    readBlob,
    drain() {
      database.exec("PRAGMA wal_checkpoint(PASSIVE)")
    },
    importElectronStores(userDataPath: string, warn: (message: string, error: unknown) => void = () => undefined) {
      if (selectMigration.get(STORE_MIGRATION)) return

      const documents = readdirSync(userDataPath, { withFileTypes: true })
        .filter((entry) => entry.isFile() && (entry.name.endsWith(".dat") || entry.name === "opencode.settings"))
        .flatMap((entry) => {
          try {
            const value: unknown = JSON.parse(readFileSync(join(userDataPath, entry.name), "utf8"))
            if (!value || typeof value !== "object" || Array.isArray(value)) {
              throw new Error("Store root must be an object")
            }
            return Object.entries(value).map(([key, item]) => ({ storage: entry.name, key, item }))
          } catch (error) {
            warn(`failed to import ${entry.name}`, error)
            return []
          }
        })

      database.exec("BEGIN IMMEDIATE")
      try {
        const now = Date.now()
        documents.forEach((item) => importDocument.run(item.storage, item.key, migrateStoredValue(item.item), now))
        insertMigration.run(STORE_MIGRATION, now)
        database.exec("COMMIT")
      } catch (error) {
        database.exec("ROLLBACK")
        throw error
      }
    },
    close() {
      database.close()
    },
  }

  function migrateStoredValue(value: unknown) {
    if (typeof value !== "string") return JSON.stringify(migrateAttachments(value)) ?? "null"
    try {
      return JSON.stringify(migrateAttachments(JSON.parse(value)))
    } catch {
      return value
    }
  }

  function migrateAttachments(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(migrateAttachments)
    if (!value || typeof value !== "object") return value
    const record = value as Record<string, unknown>
    if (record.type === "image" && typeof record.dataUrl === "string") {
      const match = /^data:[^;,]+;base64,(.*)$/s.exec(record.dataUrl)
      if (!match) return value
      const bytes = new Uint8Array(Buffer.from(match[1], "base64"))
      const digest = sha256(bytes)
      insertBlob.run(digest, bytes, bytes.byteLength, Date.now())
      return Object.fromEntries(
        Object.entries(record)
          .filter(([key]) => key !== "dataUrl")
          .concat([["blob", { digest, byteLength: bytes.byteLength }]]),
      )
    }
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, migrateAttachments(item)]))
  }
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}
