import { describe, expect, test } from "bun:test"
import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-sqlite"
import { migrate, openDatabase } from "./database"
import { migrations } from "./migration.gen"
import { extension } from "./schema"

const tables = (db: ReturnType<typeof drizzle>) =>
  db
    .all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .map((row) => row.name)

const expected = ["blob", "document", "extension", "extension_file", "migration", "state"]

describe("database", () => {
  test("bootstraps every table on a fresh database and is idempotent", () => {
    const database = openDatabase(":memory:")
    expect(tables(database.db)).toEqual(expected)
    expect(migrate(database.db)).toEqual([])
    database.close()
  })

  test("adopts a drafts.sqlite created before the journal existed", () => {
    const native = new DatabaseSync(":memory:")
    native.exec(
      "CREATE TABLE document (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE blob (id TEXT PRIMARY KEY, data BLOB NOT NULL); INSERT INTO document VALUES ('k', 'v')",
    )
    const db = drizzle({ client: native })
    expect(migrate(db)).toEqual(migrations.map((migration) => migration.id))
    expect(tables(db)).toEqual(expected)
    expect(db.all<{ value: string }>(sql`SELECT value FROM document`)).toEqual([{ value: "v" }])
    expect(migrate(db)).toEqual([])
  })

  test.each(
    [
      { name: "disabled", old: false, current: undefined, expected: false },
      { name: "enabled", old: true, current: undefined, expected: true },
      { name: "explicitly enabled", old: false, current: true, expected: true },
      { name: "explicitly disabled", old: true, current: false, expected: false },
    ].flatMap((input) =>
      [
        { oldID: "summary", newID: "details" },
        { oldID: "usage", newID: "context" },
      ].map((ids) => ({ ...input, ...ids })),
    ),
  )("keeps $name enable state when $oldID becomes $newID, without changing old rows", (input) => {
    const native = new DatabaseSync(":memory:")
    const db = drizzle({ client: native })
    native.exec("CREATE TABLE migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)")
    migrations
      .filter((migration) => migration.id <= "20260930041551_extension")
      .forEach((migration) => {
        migration.statements.forEach((statement) => native.exec(statement))
        native.prepare("INSERT INTO migration VALUES (?, 0)").run(migration.id)
      })
    db.insert(extension)
      .values({ id: input.oldID, enabled: input.old, manifest: "kept manifest", revision: "kept revision" })
      .run()

    if (input.current !== undefined)
      db.insert(extension).values({ id: input.newID, enabled: input.current }).run()

    migrate(db)

    const rows = () => db.select().from(extension).orderBy(extension.id).all()

    const expected = [
      { id: input.oldID, enabled: input.old, manifest: "kept manifest", revision: "kept revision" },
      { id: input.newID, enabled: input.expected, manifest: null, revision: null },
    ].toSorted((a, b) => a.id.localeCompare(b.id))

    expect(rows()).toEqual(expected)
    db.update(extension).set({ enabled: !input.expected }).where(sql`${extension.id} = ${input.newID}`).run()
    expect(migrate(db)).toEqual([])
    expect(rows()).toEqual(
      expected.map((row) => (row.id === input.newID ? { ...row, enabled: !input.expected } : row)),
    )
    native.close()
  })

  test("rendered registry matches the drizzle-kit output on disk", async () => {
    const directory = path.join(import.meta.dirname, "migration")

    const ids = (await Array.fromAsync(new Bun.Glob("*/migration.sql").scan({ cwd: directory })))
      .map((file) => path.dirname(file))
      .sort()

    expect(migrations.map((migration) => migration.id)).toEqual(ids)

    for (const migration of migrations) {
      const source = (await Bun.file(path.join(directory, migration.id, "migration.sql")).text()).replaceAll(
        "\r\n",
        "\n",
      )

      for (const statement of migration.statements) expect(source).toContain(statement)
    }
  })
})
