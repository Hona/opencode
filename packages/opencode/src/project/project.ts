import z from "zod"
import { Filesystem } from "../util/filesystem"
import path from "path"
import { Database, eq, and } from "../storage/db"
import { ProjectTable } from "./project.sql"
import { SessionTable } from "../session/session.sql"
import { Log } from "../util/log"
import { Flag } from "@/flag/flag"
import { fn } from "@opencode-ai/util/fn"
import { BusEvent } from "@/bus/bus-event"
import { iife } from "@/util/iife"
import { GlobalBus } from "@/bus/global"
import { existsSync } from "fs"
import { git } from "../util/git"
import { Glob } from "../util/glob"
import { which } from "../util/which"
import { ProjectID } from "./schema"
import { Path } from "@/path/path"
import { PrettyPath } from "@/path/schema"

export namespace Project {
  const log = Log.create({ service: "project" })

  function fix(input: string) {
    if (!input || input === "/") return PrettyPath.make(input)
    return Path.truecaseSync(input)
  }

  function same(a: string, b: string) {
    if (a === "/" || b === "/") return a === b
    return Path.eq(a, b)
  }

  function uniq(list: readonly string[]) {
    const seen = new Set<string>()
    const out: PrettyPath[] = []
    for (const item of list) {
      const dir = fix(item)
      const key = dir === "/" ? dir : Path.key(dir)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(dir)
    }
    return out
  }

  async function gitpath(cwd: string, name: string) {
    if (!name) return fix(cwd)
    // git output includes trailing newlines; keep path whitespace intact.
    name = name.replace(/[\r\n]+$/, "")
    if (!name) return fix(cwd)

    name = Filesystem.windowsPath(name)

    if (path.isAbsolute(name)) return await Path.truecase(name)
    return await Path.truecase(Path.pretty(name, { cwd }))
  }

  export const Info = z
    .object({
      id: ProjectID.zod,
      worktree: z.string(),
      vcs: z.literal("git").optional(),
      name: z.string().optional(),
      icon: z
        .object({
          url: z.string().optional(),
          override: z.string().optional(),
          color: z.string().optional(),
        })
        .optional(),
      commands: z
        .object({
          start: z.string().optional().describe("Startup script to run when creating a new workspace (worktree)"),
        })
        .optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        initialized: z.number().optional(),
      }),
      sandboxes: z.array(z.string()),
    })
    .meta({
      ref: "Project",
    })
  export type Info = Omit<z.infer<typeof Info>, "worktree" | "sandboxes"> & {
    worktree: PrettyPath
    sandboxes: PrettyPath[]
  }

  export const Event = {
    Updated: BusEvent.define("project.updated", Info),
  }

  type Row = typeof ProjectTable.$inferSelect

  export function fromRow(row: Row): Info {
    const icon =
      row.icon_url || row.icon_color
        ? { url: row.icon_url ?? undefined, color: row.icon_color ?? undefined }
        : undefined
    return {
      id: ProjectID.make(row.id),
      worktree: fix(row.worktree),
      vcs: row.vcs ? Info.shape.vcs.parse(row.vcs) : undefined,
      name: row.name ?? undefined,
      icon,
      time: {
        created: row.time_created,
        updated: row.time_updated,
        initialized: row.time_initialized ?? undefined,
      },
      sandboxes: uniq(row.sandboxes),
      commands: row.commands ?? undefined,
    }
  }

  function readCachedId(dir: string) {
    return Filesystem.readText(path.join(dir, "opencode"))
      .then((x) => x.trim())
      .then(ProjectID.make)
      .catch(() => undefined)
  }

  export async function fromDirectory(directory: string) {
    directory = await Path.truecase(directory)
    log.info("fromDirectory", { directory })

    const data: { id: ProjectID; worktree: PrettyPath; sandbox: PrettyPath; vcs: Info["vcs"] } = await iife(async () => {
      const matches = Filesystem.up({ targets: [".git"], start: directory })
      const dotgit = await matches.next().then((x) => x.value)
      await matches.return()
      if (dotgit) {
        let sandbox = await Path.truecase(path.dirname(dotgit))

        const gitBinary = which("git")

        // cached id calculation
        let id = await readCachedId(dotgit)

        if (!gitBinary) {
          return {
            id: id ?? ProjectID.global,
            worktree: sandbox,
            sandbox,
            vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
          }
        }

        const worktree = await git(["rev-parse", "--git-common-dir"], {
          cwd: sandbox,
        })
          .then(async (result) => {
            const common = await gitpath(sandbox, await result.text())
            // Avoid going to parent of sandbox when git-common-dir is empty.
            return same(common, sandbox) ? sandbox : fix(path.dirname(common))
          })
          .catch(() => undefined)

        if (!worktree) {
          return {
            id: id ?? ProjectID.global,
            worktree: sandbox,
            sandbox,
            vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
          }
        }

        // In the case of a git worktree, it can't cache the id
        // because `.git` is not a folder, but it always needs the
        // same project id as the common dir, so we resolve it now
        if (id == null) {
          id = await readCachedId(path.join(worktree, ".git"))
        }

        // generate id from root commit
        if (!id) {
          const roots = await git(["rev-list", "--max-parents=0", "HEAD"], {
            cwd: sandbox,
          })
            .then(async (result) =>
              (await result.text())
                .split("\n")
                .filter(Boolean)
                .map((x) => x.trim())
                .toSorted(),
            )
            .catch(() => undefined)

          if (!roots) {
            return {
              id: ProjectID.global,
              worktree: sandbox,
              sandbox,
              vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
            }
          }

          id = roots[0] ? ProjectID.make(roots[0]) : undefined
          if (id) {
            // Write to common dir so the cache is shared across worktrees.
            await Filesystem.write(path.join(worktree, ".git", "opencode"), id).catch(() => undefined)
          }
        }

        if (!id) {
          return {
            id: ProjectID.global,
            worktree: sandbox,
            sandbox,
            vcs: "git",
          }
        }

        const top = await git(["rev-parse", "--show-toplevel"], {
          cwd: sandbox,
        })
          .then(async (result) => gitpath(sandbox, await result.text()))
          .catch(() => undefined)

        if (!top) {
          return {
            id,
            worktree: sandbox,
            sandbox,
            vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
          }
        }

        sandbox = top

        return {
          id,
          sandbox,
          worktree,
          vcs: "git",
        }
      }

      return {
        id: ProjectID.global,
        worktree: PrettyPath.make("/"),
        sandbox: PrettyPath.make("/"),
        vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
      }
    })

    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, data.id)).get())
    const existing: Info = row
      ? fromRow(row)
      : {
          id: data.id,
          worktree: data.worktree,
          vcs: data.vcs,
          sandboxes: [],
          time: {
            created: Date.now(),
            updated: Date.now(),
          },
        }

    if (Flag.OPENCODE_EXPERIMENTAL_ICON_DISCOVERY) discover(existing)

    const result: Info = {
      ...existing,
      worktree: data.worktree,
      sandboxes: uniq(existing.sandboxes),
      vcs: data.vcs,
      time: {
        ...existing.time,
        updated: Date.now(),
      },
    }
    if (!same(data.sandbox, result.worktree) && !result.sandboxes.some((item) => same(item, data.sandbox))) {
      result.sandboxes.push(fix(data.sandbox))
    }
    result.sandboxes = uniq(result.sandboxes).filter((item) => existsSync(item))
    const insert = {
      id: result.id,
      worktree: result.worktree,
      vcs: result.vcs ?? null,
      name: result.name,
      icon_url: result.icon?.url,
      icon_color: result.icon?.color,
      time_created: result.time.created,
      time_updated: result.time.updated,
      time_initialized: result.time.initialized,
      sandboxes: result.sandboxes,
      commands: result.commands,
    }
    const updateSet = {
      worktree: result.worktree,
      vcs: result.vcs ?? null,
      name: result.name,
      icon_url: result.icon?.url,
      icon_color: result.icon?.color,
      time_updated: result.time.updated,
      time_initialized: result.time.initialized,
      sandboxes: result.sandboxes,
      commands: result.commands,
    }
    Database.use((db) =>
      db.insert(ProjectTable).values(insert).onConflictDoUpdate({ target: ProjectTable.id, set: updateSet }).run(),
    )
    // Runs after upsert so the target project row exists (FK constraint).
    // Runs on every startup because sessions created before git init
    // accumulate under "global" and need migrating whenever they appear.
    if (data.id !== ProjectID.global) {
      Database.use((db) =>
        db
          .update(SessionTable)
          .set({ project_id: data.id })
          .where(and(eq(SessionTable.project_id, ProjectID.global), eq(SessionTable.directory, data.worktree)))
          .run(),
      )
    }
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: result,
      },
    })
    return { project: result, sandbox: data.sandbox }
  }

  export async function discover(input: Info) {
    if (input.vcs !== "git") return
    if (input.icon?.override) return
    if (input.icon?.url) return
    const matches = await Glob.scan("**/favicon.{ico,png,svg,jpg,jpeg,webp}", {
      cwd: input.worktree,
      absolute: true,
      include: "file",
    })
    const shortest = matches.sort((a, b) => a.length - b.length)[0]
    if (!shortest) return
    const buffer = await Filesystem.readBytes(shortest)
    const base64 = buffer.toString("base64")
    const mime = Filesystem.mimeType(shortest) || "image/png"
    const url = `data:${mime};base64,${base64}`
    await update({
      projectID: input.id,
      icon: {
        url,
      },
    })
    return
  }

  export function setInitialized(id: ProjectID) {
    Database.use((db) =>
      db
        .update(ProjectTable)
        .set({
          time_initialized: Date.now(),
        })
        .where(eq(ProjectTable.id, id))
        .run(),
    )
  }

  export function list() {
    return Database.use((db) =>
      db
        .select()
        .from(ProjectTable)
        .all()
        .map((row) => fromRow(row)),
    )
  }

  export function get(id: ProjectID): Info | undefined {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) return undefined
    return fromRow(row)
  }

  export async function initGit(input: { directory: string; project: Info }) {
    if (input.project.vcs === "git") return input.project
    if (!which("git")) throw new Error("Git is not installed")

    const result = await git(["init", "--quiet"], {
      cwd: input.directory,
    })
    if (result.exitCode !== 0) {
      const text = result.stderr.toString().trim() || result.text().trim()
      throw new Error(text || "Failed to initialize git repository")
    }

    return (await fromDirectory(input.directory)).project
  }

  export const update = fn(
    z.object({
      projectID: ProjectID.zod,
      name: z.string().optional(),
      icon: Info.shape.icon.optional(),
      commands: Info.shape.commands.optional(),
    }),
    async (input) => {
      const id = ProjectID.make(input.projectID)
      const result = Database.use((db) =>
        db
          .update(ProjectTable)
          .set({
            name: input.name,
            icon_url: input.icon?.url,
            icon_color: input.icon?.color,
            commands: input.commands,
            time_updated: Date.now(),
          })
          .where(eq(ProjectTable.id, id))
          .returning()
          .get(),
      )
      if (!result) throw new Error(`Project not found: ${input.projectID}`)
      const data = fromRow(result)
      GlobalBus.emit("event", {
        payload: {
          type: Event.Updated.type,
          properties: data,
        },
      })
      return data
    },
  )

  export async function sandboxes(id: ProjectID) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) return []
    const data = fromRow(row)
    const valid: PrettyPath[] = []
    for (const dir of data.sandboxes) {
      const s = Filesystem.stat(dir)
      if (s?.isDirectory() && !valid.some((item) => same(item, dir))) valid.push(dir)
    }
    return valid
  }

  export async function addSandbox(id: ProjectID, directory: string) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) throw new Error(`Project not found: ${id}`)
    const dir = fix(directory)
    const sandboxes = uniq(row.sandboxes)
    if (!sandboxes.some((item) => same(item, dir))) sandboxes.push(dir)
    const result = Database.use((db) =>
      db
        .update(ProjectTable)
        .set({ sandboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .get(),
    )
    if (!result) throw new Error(`Project not found: ${id}`)
    const data = fromRow(result)
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: data,
      },
    })
    return data
  }

  export async function removeSandbox(id: ProjectID, directory: string) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) throw new Error(`Project not found: ${id}`)
    const dir = fix(directory)
    const sandboxes = uniq(row.sandboxes).filter((item) => !same(item, dir))
    const result = Database.use((db) =>
      db
        .update(ProjectTable)
        .set({ sandboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .get(),
    )
    if (!result) throw new Error(`Project not found: ${id}`)
    const data = fromRow(result)
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: data,
      },
    })
    return data
  }
}
