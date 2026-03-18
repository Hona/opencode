import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Project } from "../../src/project/project"
import { Session } from "../../src/session"
import { Database, eq } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { SessionTable } from "../../src/session/session.sql"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { WorkspaceID } from "../../src/control-plane/schema"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { PathMigration } from "../../src/path/migrate"
import { Filesystem } from "../../src/util/filesystem"

afterEach(async () => {
  delete process.env.OPENCODE_FORCE_PATH_MIGRATION
  await resetDatabase()
})

function raw(dir: string) {
  if (process.platform === "win32") return path.join(dir.toUpperCase(), "child", "..")
  return path.join(dir, "child", "..")
}

function sid() {
  return SessionID.make(crypto.randomUUID())
}

describe("PathMigration.run", () => {
  test("rewrites authoritative path rows and dedupes sandboxes", async () => {
    await using tmp = await tmpdir({ git: true })
    const box = path.join(tmp.path, "sandbox")
    await Filesystem.write(path.join(box, ".keep"), "")

    const { project } = await Project.fromDirectory(tmp.path)
    const sessionID = sid()
    const workspaceID = WorkspaceID.ascending()
    const mark = path.join(tmp.path, "path-migration.json")
    const now = Date.now()

    Database.use((db) => {
      db.insert(SessionTable)
        .values({
          id: sessionID,
          project_id: project.id,
          slug: sessionID,
          directory: raw(tmp.path),
          title: "test",
          version: "0.0.0-test",
          time_created: now,
          time_updated: now,
        })
        .run()

      db.insert(WorkspaceTable)
        .values({
          id: workspaceID,
          type: "worktree",
          branch: null,
          name: "local",
          directory: raw(tmp.path),
          extra: null,
          project_id: project.id,
        })
        .run()

      db
        .update(ProjectTable)
        .set({
          worktree: raw(tmp.path),
          sandboxes: [raw(box), path.join(raw(box), "again", ".."), raw(tmp.path)],
        })
        .where(eq(ProjectTable.id, project.id))
        .run()
    })

    const result = await PathMigration.run({ force: true, marker: mark })

    expect(result.skipped).toBe(false)
    expect(result.change).toEqual({
      project: 1,
      session: 1,
      workspace: 1,
    })
    expect(await Filesystem.exists(mark)).toBe(true)

    const prow = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, project.id)).get())
    const srow = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())
    const wrow = Database.use((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID)).get())

    expect(prow?.worktree).toBe(tmp.path)
    expect(prow?.sandboxes).toEqual([box])
    expect(srow?.directory).toBe(tmp.path)
    expect(wrow?.directory).toBe(tmp.path)
  })

  test("normalizes new session rows on write", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)
    const row = Session.toRow({
      id: sid(),
      slug: "slug",
      projectID: project.id,
      directory: raw(tmp.path),
      title: "test",
      version: "0.0.0-test",
      time: {
        created: 1,
        updated: 1,
      },
    })

    expect(row.directory).toBe(tmp.path)
  })

  test("is idempotent and only reruns when forced", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)
    const mark = path.join(tmp.path, "path-migration.json")

    Database.use((db) =>
      db
        .update(ProjectTable)
        .set({ worktree: raw(tmp.path) })
        .where(eq(ProjectTable.id, project.id))
        .run(),
    )

    const first = await PathMigration.run({ force: true, marker: mark })
    const second = await PathMigration.run({ force: true, marker: mark })

    expect(first.change.project).toBe(1)
    expect(second.change).toEqual({
      project: 0,
      session: 0,
      workspace: 0,
    })

    Database.use((db) =>
      db
        .update(ProjectTable)
        .set({ worktree: raw(tmp.path) })
        .where(eq(ProjectTable.id, project.id))
        .run(),
    )

    const skip = await PathMigration.run({ marker: mark })
    expect(skip.skipped).toBe(true)

    const rawrow = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, project.id)).get())
    expect(rawrow?.worktree).not.toBe(tmp.path)

    const forced = await PathMigration.run({ force: true, marker: mark })
    const next = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, project.id)).get())

    expect(forced.change.project).toBe(1)
    expect(next?.worktree).toBe(tmp.path)
  })
})
