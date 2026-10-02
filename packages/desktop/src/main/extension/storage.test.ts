import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Schema } from "effect"
import { openDatabase, type Database } from "../storage/database"
import { createStateStore } from "../storage/state"
import { createStorage } from "./storage"

const roots: string[] = []

// Bun's node:sqlite shim pins the WAL files on Windows after close(); tolerate the leftover here only.
afterEach(() =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }).catch(() => undefined))),
)

const open = (db: Database) => {
  const storage = createStorage(createStateStore(db), "example")

  return {
    storage,
    store: storage.store("servers", { schema: Schema.Array(Schema.String), initial: [] }),
  }
}

describe("main extension storage", () => {
  // A crash right after saving keeps the value: another connection reads it without any flush.
  test.each([
    { name: "update", write: (opened: ReturnType<typeof open>) => opened.store.update(() => ["a"]), expected: ["a"] },
    {
      // The open store holds what was stored, not the caller's list, which changes afterwards.
      name: "a returned list",
      write: (opened: ReturnType<typeof open>) => {
        const list = ["a"]

        opened.store.update(() => list)
        list.push("b")
      },
      expected: ["a"],
    },
    {
      name: "remove",
      write: (opened: ReturnType<typeof open>) => {
        opened.store.update(() => ["a"])
        opened.storage.remove("servers")
      },
      expected: [],
    },
  ])("$name reaches the database before it returns, and the open store reads it", async (row) => {
    const root = await mkdtemp(path.join(tmpdir(), "opencode-extension-storage-"))
    roots.push(root)
    const file = path.join(root, "drafts.sqlite")
    const writer = openDatabase(file)
    const reader = openDatabase(file)
    const opened = open(writer.db)
    row.write(opened)
    expect({ stored: open(reader.db).store.value, open: opened.store.value, ready: opened.store.ready() }).toEqual({
      stored: row.expected,
      open: row.expected,
      ready: true,
    })
    writer.close()
    reader.close()
  })
})
