import { beforeEach, describe, expect } from "bun:test"
import { realpathSync } from "fs"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { DataMigration } from "@/data-migration"
import { DataMigrationTable } from "@/data-migration.sql"
import { ProjectTable } from "@/project/project.sql"
import { ProjectID } from "@/project/schema"
import { SessionTable } from "@/session/session.sql"
import { SessionID } from "@/session/schema"
import { WorkspaceTable } from "@/control-plane/workspace.sql"
import { WorkspaceID } from "@/control-plane/schema"
import { EventSequenceTable, EventTable } from "@/sync/event.sql"
import { Database } from "@/storage/db"
import { pollWithTimeout, it } from "../lib/effect"

beforeEach(() => {
  Database.close()
})

describe("path normalization data migration", () => {
  it.live("normalizes persisted Windows database paths to forward slashes and real casing", () =>
    Effect.gen(function* () {
      if (process.platform !== "win32") return

      const workspaceDirectory = realpathSync.native(process.cwd()).replaceAll("\\", "/")
      const storedWorkspaceDirectory = workspaceDirectory.toLowerCase().replaceAll("/", "\\")

      yield* Effect.sync(() =>
        Database.use((db) => {
          db.insert(ProjectTable)
            .values({
              id: ProjectID.make("project_path"),
              worktree: "C:\\Repos\\MY-Cool-THING",
              vcs: "git",
              time_created: 1,
              time_updated: 1,
              sandboxes: ["C:\\Repos\\MY-Cool-THING\\sandbox"],
            })
            .run()
          db.insert(SessionTable)
            .values({
              id: SessionID.make("ses_path"),
              project_id: ProjectID.make("project_path"),
              slug: "path",
              directory: "C:\\Repos\\MY-Cool-THING\\packages\\api",
              path: "packages\\api",
              title: "Path",
              version: "test",
              time_created: 1,
              time_updated: 1,
            })
            .run()
          db.insert(WorkspaceTable)
            .values({
              id: WorkspaceID.make("wrk_path"),
              type: "worktree",
              name: "Path",
              directory: storedWorkspaceDirectory,
              project_id: ProjectID.make("project_path"),
              time_used: 1,
            })
            .run()
          db.insert(EventSequenceTable).values({ aggregate_id: "ses_path", seq: 0 }).run()
          db.insert(EventTable)
            .values({
              id: "evt_path",
              aggregate_id: "ses_path",
              seq: 0,
              type: "session.created.1",
              data: {
                sessionID: "ses_path",
                info: {
                  directory: "C:\\Repos\\MY-Cool-THING\\packages\\api",
                  path: "packages\\api",
                },
              },
            })
            .run()
        }),
      )

      yield* Layer.build(DataMigration.layer)

      const rows = yield* pollWithTimeout(
        Effect.sync(() =>
          Database.use((db) => {
            const completed = db
              .select()
              .from(DataMigrationTable)
              .where(eq(DataMigrationTable.name, "normalize_paths_to_forward_slashes"))
              .get()
            if (!completed) return
            return {
              project: db.select().from(ProjectTable).get(),
              session: db.select().from(SessionTable).get(),
              workspace: db.select().from(WorkspaceTable).get(),
              event: db.select().from(EventTable).get(),
            }
          }),
        ),
        "path normalization migration did not complete",
      )

      expect(rows.project?.worktree).toBe("C:/Repos/MY-Cool-THING")
      expect(rows.project?.sandboxes).toEqual(["C:/Repos/MY-Cool-THING/sandbox"])
      expect(rows.session?.directory).toBe("C:/Repos/MY-Cool-THING/packages/api")
      expect(rows.session?.path).toBe("packages/api")
      expect(rows.workspace?.directory).toBe(workspaceDirectory)
      expect((rows.event?.data as { info?: unknown } | undefined)?.info).toEqual({
        directory: "C:/Repos/MY-Cool-THING/packages/api",
        path: "packages/api",
      })
    }),
  )
})
