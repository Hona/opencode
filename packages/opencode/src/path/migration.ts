import path from "path"
import { eq } from "@/storage/db"
import { Global } from "@/global"
import { Log } from "@/util/log"
import { Filesystem } from "@/util/filesystem"
import { Database } from "@/storage/db"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import { WorkspaceTable } from "@/control-plane/workspace.sql"
import { Path } from "./path"

export namespace PathMigration {
  const log = Log.create({ service: "path-migration" })

  const uniq = (input: string[]) => [...new Set(input.map((item) => Path.stored(item)))]

  export type Stats = {
    projects: number
    sessions: number
    workspaces: number
  }

  export async function run(input: { force?: boolean; marker?: string } = {}) {
    if (process.platform !== "win32") {
      return { projects: 0, sessions: 0, workspaces: 0 } satisfies Stats
    }

    const mark = input.marker ?? path.join(Global.Path.state, "stored-path-v1")
    if (!input.force && (await Filesystem.exists(mark))) {
      return { projects: 0, sessions: 0, workspaces: 0 } satisfies Stats
    }

    const stats = Database.transaction((db) => {
      const stats = { projects: 0, sessions: 0, workspaces: 0 } satisfies Stats

      for (const row of db.select().from(ProjectTable).all()) {
        const worktree = Path.stored(row.worktree)
        const sandboxes = uniq(row.sandboxes)
        if (
          worktree === row.worktree &&
          sandboxes.every((item, idx) => item === row.sandboxes[idx]) &&
          sandboxes.length === row.sandboxes.length
        )
          continue

        db.update(ProjectTable).set({ worktree, sandboxes }).where(eq(ProjectTable.id, row.id)).run()
        stats.projects += 1
      }

      for (const row of db.select().from(SessionTable).all()) {
        const directory = Path.stored(row.directory)
        if (directory === row.directory) continue

        db.update(SessionTable).set({ directory }).where(eq(SessionTable.id, row.id)).run()
        stats.sessions += 1
      }

      for (const row of db.select().from(WorkspaceTable).all()) {
        const directory = row.directory ? Path.stored(row.directory) : null
        if (directory === row.directory) continue

        db.update(WorkspaceTable).set({ directory }).where(eq(WorkspaceTable.id, row.id)).run()
        stats.workspaces += 1
      }

      return stats
    })

    log.info("completed", stats)
    if (!input.force) await Filesystem.write(mark, "1")
    return stats
  }
}
