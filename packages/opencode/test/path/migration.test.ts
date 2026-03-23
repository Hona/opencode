import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "../../src/global"
import { Database } from "../../src/storage/db"
import { ProjectID } from "../../src/project/schema"
import { ProjectTable } from "../../src/project/project.sql"
import { SessionID } from "../../src/session/schema"
import { SessionTable } from "../../src/session/session.sql"
import { WorkspaceID } from "../../src/control-plane/schema"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { PathMigration } from "../../src/path/migration"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { eq } from "../../src/storage/db"

const bash = (input: string) => {
  const drive = input[0].toLowerCase()
  const rest = input.slice(2).replaceAll("\\", "/")
  return `/${drive}${rest}`
}

afterEach(async () => {
  await resetDatabase()
})

describe("path migration", () => {
  test("rewrites old stored project, sandbox, session, and workspace paths", async () => {
    if (process.platform !== "win32") return
    await resetDatabase()
    await using tmp = await tmpdir({ git: true })

    const prev = Global.Path.state
    ;(Global.Path as { state: string }).state = tmp.path

    try {
      const low = tmp.path.replace(/^[A-Z]:/, (x) => x.toLowerCase())
      const raw = bash(tmp.path)
      const projectID = ProjectID.make("project-path-migrate")
      const sessionID = SessionID.make("session-path-migrate")
      const workspaceID = WorkspaceID.make("workspace-path-migrate")

      Database.use((db) => {
        db.insert(ProjectTable)
          .values({
            id: projectID,
            worktree: raw,
            vcs: "git",
            name: null,
            icon_url: null,
            icon_color: null,
            time_created: 1,
            time_updated: 1,
            time_initialized: null,
            sandboxes: [low, tmp.path],
            commands: null,
          })
          .run()

        db.insert(SessionTable)
          .values({
            id: sessionID,
            project_id: projectID,
            workspace_id: null,
            parent_id: null,
            slug: "session-path-migrate",
            directory: raw,
            title: "session",
            version: "v2",
            share_url: null,
            summary_additions: null,
            summary_deletions: null,
            summary_files: null,
            summary_diffs: null,
            revert: null,
            permission: null,
            time_created: 1,
            time_updated: 1,
            time_compacting: null,
            time_archived: null,
          })
          .run()

        db.insert(WorkspaceTable)
          .values({
            id: workspaceID,
            type: "worktree",
            branch: null,
            name: "workspace",
            directory: low,
            extra: null,
            project_id: projectID,
          })
          .run()
      })

      const stats = await PathMigration.run({ force: true, marker: path.join(tmp.path, "marker") })

      const project = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, projectID)).get())
      const session = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())
      const workspace = Database.use((db) =>
        db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID)).get(),
      )

      expect(stats).toEqual({ projects: 1, sessions: 1, workspaces: 1 })
      expect(project?.worktree).toBe(tmp.path)
      expect(project?.sandboxes).toEqual([tmp.path])
      expect(session?.directory).toBe(tmp.path)
      expect(workspace?.directory).toBe(tmp.path)
    } finally {
      ;(Global.Path as { state: string }).state = prev
    }
  })
})
