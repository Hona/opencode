import { Context, Effect, Layer } from "effect"
import { Database } from "./storage/db"
import { DataMigrationTable } from "./data-migration.sql"
import * as Log from "@opencode-ai/core/util/log"
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm"
import { MessageTable, SessionTable } from "./session/session.sql"
import type { SessionID } from "./session/schema"
import { ProjectTable } from "./project/project.sql"
import { WorkspaceTable } from "./control-plane/workspace.sql"
import { EventTable } from "./sync/event.sql"
import { PathIdentity } from "./util/path-identity"

export type Migration<R = never> = {
  name: string
  run: Effect.Effect<void, unknown, R>
}

const log = Log.create({ service: "data-migration" })

export interface Interface {}

export class Service extends Context.Service<Service, Interface>()("@opencode/DataMigration") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const migrations: Migration[] = [
      {
        name: "normalize_paths_to_forward_slashes",
        run: Effect.sync(normalizePathRows),
      },
      {
        name: "session_usage_from_messages",
        run: Effect.gen(function* () {
          type Usage = {
            cost: number
            tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
          }

          for (let cursor: SessionID | undefined, page = 1; ; page++) {
            const next = yield* Effect.gen(function* () {
              const sessions = yield* Effect.sync(() =>
                Database.use((db) =>
                  db
                    .select({ id: SessionTable.id })
                    .from(SessionTable)
                    .where(cursor ? gt(SessionTable.id, cursor) : undefined)
                    .orderBy(asc(SessionTable.id))
                    .limit(100)
                    .all(),
                ),
              )
              if (sessions.length === 0) return

              yield* Effect.sync(() =>
                Database.transaction((db) => {
                  const usageBySession = new Map<SessionID, Usage>(
                    sessions.map((session) => [
                      session.id,
                      { cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
                    ]),
                  )

                  for (const row of db
                    .select({
                      session_id: MessageTable.session_id,
                      cost: sql<number>`coalesce(sum(coalesce(json_extract(${MessageTable.data}, '$.cost'), 0)), 0)`,
                      tokens_input: sql<number>`coalesce(sum(coalesce(json_extract(${MessageTable.data}, '$.tokens.input'), 0)), 0)`,
                      tokens_output: sql<number>`coalesce(sum(coalesce(json_extract(${MessageTable.data}, '$.tokens.output'), 0)), 0)`,
                      tokens_reasoning: sql<number>`coalesce(sum(coalesce(json_extract(${MessageTable.data}, '$.tokens.reasoning'), 0)), 0)`,
                      tokens_cache_read: sql<number>`coalesce(sum(coalesce(json_extract(${MessageTable.data}, '$.tokens.cache.read'), 0)), 0)`,
                      tokens_cache_write: sql<number>`coalesce(sum(coalesce(json_extract(${MessageTable.data}, '$.tokens.cache.write'), 0)), 0)`,
                    })
                    .from(MessageTable)
                    .where(
                      and(
                        inArray(
                          MessageTable.session_id,
                          sessions.map((session) => session.id),
                        ),
                        sql`json_extract(${MessageTable.data}, '$.role') = 'assistant'`,
                      ),
                    )
                    .groupBy(MessageTable.session_id)
                    .all()) {
                    const current = usageBySession.get(row.session_id)
                    if (!current) continue
                    current.cost = row.cost
                    current.tokens.input = row.tokens_input
                    current.tokens.output = row.tokens_output
                    current.tokens.reasoning = row.tokens_reasoning
                    current.tokens.cache.read = row.tokens_cache_read
                    current.tokens.cache.write = row.tokens_cache_write
                  }

                  for (const [sessionID, value] of usageBySession) {
                    db.update(SessionTable)
                      .set({
                        cost: value.cost,
                        tokens_input: value.tokens.input,
                        tokens_output: value.tokens.output,
                        tokens_reasoning: value.tokens.reasoning,
                        tokens_cache_read: value.tokens.cache.read,
                        tokens_cache_write: value.tokens.cache.write,
                        time_updated: sql`${SessionTable.time_updated}`,
                      })
                      .where(eq(SessionTable.id, sessionID))
                      .run()
                  }
                }),
              )

              return sessions.at(-1)?.id
            }).pipe(
              Effect.withSpan("DataMigration.sessionUsage.page", {
                attributes: {
                  "data_migration.name": "session_usage_from_messages",
                  "data_migration.page": page,
                  "data_migration.cursor": cursor ?? "",
                },
              }),
            )
            if (!next) return
            cursor = next
            yield* Effect.sleep("10 millis")
          }
        }),
      },
    ]

    yield* Effect.gen(function* () {
      if (migrations.length === 0) return

      // Migrations run in a background fiber, so they must be resumable until
      // their completion row is written.
      for (const migration of migrations) {
        const completed = Database.use((db) =>
          db
            .select({ name: DataMigrationTable.name })
            .from(DataMigrationTable)
            .where(eq(DataMigrationTable.name, migration.name))
            .get(),
        )
        if (completed) continue

        log.info("running data migration", { name: migration.name })
        yield* migration.run.pipe(Effect.withSpan("DataMigration", { attributes: { name: migration.name } }))
        Database.use((db) =>
          db
            .insert(DataMigrationTable)
            .values({ name: migration.name, time_completed: Date.now() })
            .onConflictDoNothing()
            .run(),
        )
      }
    }).pipe(
      Effect.tapCause((cause) =>
        Effect.logError("failed to run data migrations").pipe(Effect.annotateLogs("cause", cause)),
      ),
      Effect.ignore,
      Effect.forkScoped,
    )
    return Service.of({})
  }),
)

export const defaultLayer = layer

export * as DataMigration from "./data-migration"

function normalizePathRows() {
  Database.transaction((db) => {
    for (const row of db.select().from(ProjectTable).all()) {
      const worktree = PathIdentity.toStoragePath(row.worktree)
      const sandboxes = row.sandboxes.map((sandbox) => PathIdentity.toStoragePath(sandbox))
      if (worktree === row.worktree && sameList(sandboxes, row.sandboxes)) continue
      db.update(ProjectTable)
        .set({ worktree, sandboxes, time_updated: sql`${ProjectTable.time_updated}` })
        .where(eq(ProjectTable.id, row.id))
        .run()
    }

    for (const row of db.select().from(SessionTable).all()) {
      const directory = PathIdentity.toStoragePath(row.directory)
      const path = PathIdentity.toStorageRelativePath(row.path)
      if (directory === row.directory && path === row.path) continue
      db.update(SessionTable)
        .set({ directory, path, time_updated: sql`${SessionTable.time_updated}` })
        .where(eq(SessionTable.id, row.id))
        .run()
    }

    for (const row of db
      .select()
      .from(WorkspaceTable)
      .where(sql`${WorkspaceTable.directory} is not null`)
      .all()) {
      const directory = PathIdentity.toStoragePath(row.directory)
      if (directory === row.directory) continue
      db.update(WorkspaceTable).set({ directory }).where(eq(WorkspaceTable.id, row.id)).run()
    }

    for (const row of db
      .select()
      .from(EventTable)
      .where(
        sql`json_type(${EventTable.data}, '$.info.directory') = 'text' or json_type(${EventTable.data}, '$.info.path') = 'text'`,
      )
      .all()) {
      const data = normalizeEventPathData(row.data)
      if (data === row.data) continue
      db.update(EventTable).set({ data }).where(eq(EventTable.id, row.id)).run()
    }
  })
}

function normalizeEventPathData(data: Record<string, unknown>) {
  const info = object(data.info)
  if (!info) return data

  const directory = typeof info.directory === "string" ? PathIdentity.toStoragePath(info.directory) : info.directory
  const path = typeof info.path === "string" ? PathIdentity.toStorageRelativePath(info.path) : info.path
  if (directory === info.directory && path === info.path) return data

  return { ...data, info: { ...info, directory, path } }
}

function object(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  return input as Record<string, unknown>
}

function sameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((item, index) => item === b[index])
}
