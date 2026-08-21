import { DateTime, Schema } from "effect"
import { Agent } from "../agent.js"
import { Location } from "../location.js"
import { Model } from "../model.js"
import { Project } from "../project.js"
import { Provider } from "../provider.js"
import { AbsolutePath, RelativePath } from "../schema.js"
import { Workspace } from "../workspace.js"
import { SessionSchema } from "./schema.js"
import { SessionTable } from "./sql.js"
import { PersistedRevert } from "@opencode-ai/schema/session-revert"
import { Money } from "@opencode-ai/schema/money"

const decodeRevert = Schema.decodeUnknownSync(PersistedRevert)

export const infoColumns = {
  id: SessionTable.id,
  project_id: SessionTable.project_id,
  workspace_id: SessionTable.workspace_id,
  parent_id: SessionTable.parent_id,
  fork_session_id: SessionTable.fork_session_id,
  fork_boundary: SessionTable.fork_boundary,
  title: SessionTable.title,
  agent: SessionTable.agent,
  model: SessionTable.model,
  cost: SessionTable.cost,
  tokens_input: SessionTable.tokens_input,
  tokens_output: SessionTable.tokens_output,
  tokens_reasoning: SessionTable.tokens_reasoning,
  tokens_cache_read: SessionTable.tokens_cache_read,
  tokens_cache_write: SessionTable.tokens_cache_write,
  directory: SessionTable.directory,
  path: SessionTable.path,
  revert: SessionTable.revert,
  time_created: SessionTable.time_created,
  time_updated: SessionTable.time_updated,
  time_archived: SessionTable.time_archived,
}

export function fromRow(row: Pick<typeof SessionTable.$inferSelect, keyof typeof infoColumns>): SessionSchema.Info {
  return SessionSchema.Info.make({
    id: SessionSchema.ID.make(row.id),
    projectID: Project.ID.make(row.project_id),
    title: row.title ?? undefined,
    parentID: row.parent_id ? SessionSchema.ID.make(row.parent_id) : undefined,
    fork:
      row.fork_session_id && row.fork_boundary
        ? {
            sessionID: SessionSchema.ID.make(row.fork_session_id),
            boundary: row.fork_boundary,
          }
        : undefined,
    agent: row.agent ? Agent.ID.make(row.agent) : undefined,
    model: row.model
      ? {
          id: Model.ID.make(row.model.id),
          providerID: Provider.ID.make(row.model.providerID),
          variant: Model.VariantID.make(row.model.variant ?? "default"),
        }
      : undefined,
    cost: Money.USD.make(row.cost),
    tokens: {
      input: row.tokens_input,
      output: row.tokens_output,
      reasoning: row.tokens_reasoning,
      cache: {
        read: row.tokens_cache_read,
        write: row.tokens_cache_write,
      },
    },
    location: Location.Ref.make({
      directory: AbsolutePath.make(row.directory),
      workspaceID: row.workspace_id ? Workspace.ID.make(row.workspace_id) : undefined,
    }),
    subpath: row.path ? RelativePath.make(row.path) : undefined,
    revert: row.revert ? decodeRevert(row.revert) : undefined,
    time: {
      created: DateTime.makeUnsafe(row.time_created),
      updated: DateTime.makeUnsafe(row.time_updated),
      archived: row.time_archived ? DateTime.makeUnsafe(row.time_archived) : undefined,
    },
  })
}
