import path from "path"
import { ProjectTable } from "@/project/project.sql"
import { Path } from "@/path/path"
import type { PrettyPath } from "@/path/schema"
import { Global } from "@/global"
import { Database, eq } from "@/storage/db"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { SessionTable } from "@/session/session.sql"
import { WorkspaceTable } from "@/control-plane/workspace.sql"

export namespace PathMigration {
  const VERSION = 1
  const log = Log.create({ service: "path-migration" })

  type Opts = {
    force?: boolean
    marker?: string
  }

  type Marker = {
    version: number
    db: string
    sig: string
    time: number
  }

  export type Result = {
    skipped: boolean
    marker: string
    change: {
      project: number
      session: number
      workspace: number
    }
  }

  const stored = Path.truecaseSync

  function same(a: string[], b: string[]) {
    return a.length === b.length && a.every((item, idx) => item === b[idx])
  }

  function uniq(list: string[], worktree?: string) {
    const seen = new Set<string>()
    const out: PrettyPath[] = []
    for (const item of list) {
      const dir = stored(item)
      if (dir && worktree && Path.eq(dir, worktree)) continue
      const id = Path.key(dir)
      if (seen.has(id)) continue
      seen.add(id)
      out.push(dir)
    }
    return out
  }

  function sig() {
    const stat = Filesystem.stat(Database.Path)
    if (!stat) return ""
    const ino = typeof stat.ino === "bigint" ? Number(stat.ino) : stat.ino
    const birth = typeof stat.birthtimeMs === "bigint" ? Number(stat.birthtimeMs) : stat.birthtimeMs
    return `${ino ?? 0}:${birth ?? 0}`
  }

  export function marker() {
    return path.join(Global.Path.data, "migration", "path", `${path.basename(Database.Path)}-v${VERSION}.json`)
  }

  async function done(file: string, force?: boolean) {
    if (force || process.env.OPENCODE_FORCE_PATH_MIGRATION === "1") return false
    const mark = await Filesystem.readJson<Marker>(file).catch(() => undefined)
    if (!mark) return false
    const db = sig()
    if (!db || mark.sig !== db) return false
    return mark.version === VERSION && mark.db === Database.Path
  }

  async function write(file: string) {
    await Filesystem.writeJson(file, {
      version: VERSION,
      db: Database.Path,
      sig: sig(),
      time: Date.now(),
    } satisfies Marker)
  }

  export async function run(opts: Opts = {}): Promise<Result> {
    const file = opts.marker ?? marker()
    if (await done(file, opts.force)) {
      return {
        skipped: true,
        marker: file,
        change: {
          project: 0,
          session: 0,
          workspace: 0,
        },
      }
    }

    const change = Database.transaction((db) => {
      const change = {
        project: 0,
        session: 0,
        workspace: 0,
      }

      for (const row of db.select().from(ProjectTable).all()) {
        const worktree = stored(row.worktree)
        const sandboxes = uniq(row.sandboxes, worktree)
        if (worktree === row.worktree && same(sandboxes, row.sandboxes)) continue
        db.update(ProjectTable).set({ worktree, sandboxes }).where(eq(ProjectTable.id, row.id)).run()
        change.project++
      }

      for (const row of db.select().from(SessionTable).all()) {
        const directory = stored(row.directory)
        if (directory === row.directory) continue
        db.update(SessionTable).set({ directory }).where(eq(SessionTable.id, row.id)).run()
        change.session++
      }

      for (const row of db.select().from(WorkspaceTable).all()) {
        const directory = row.directory ? stored(row.directory) : null
        if (directory === row.directory) continue
        db.update(WorkspaceTable).set({ directory }).where(eq(WorkspaceTable.id, row.id)).run()
        change.workspace++
      }

      return change
    })

    await write(file)
    log.info("completed", {
      marker: file,
      ...change,
    })
    return {
      skipped: false,
      marker: file,
      change,
    }
  }
}
