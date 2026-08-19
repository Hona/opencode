import type { FileDiffInfo, SessionInfo, SessionMessageInfo } from "@opencode-ai/client/promise"
import type { V1Migration } from "@opencode-ai/core/database/v1-migration.bun"
import type { SessionV1 } from "@opencode-ai/schema/session-v1"
import type { Share } from "./share"

export async function readShareDocument(data: Share.Data[]) {
  const blob = parseShareBlob(data)
  if (blob.type === "current") {
    return {
      session: blob.session,
      messages: blob.messages,
      diffs: currentDiffs(blob.diffs),
      models: blob.models,
      warnings: [],
    }
  }

  const migrated = await mapFromLegacySession(blob)
  return {
    ...migrated,
    diffs: currentDiffs(blob.diffs),
    models: blob.models,
  }
}

async function mapFromLegacySession(blob: {
  session: Share.StoredSession
  messages: Share.StoredMessage[]
  parts: Share.StoredPart[]
}) {
  const [{ V1Migration }, { SessionV1 }, { Schema }] = await Promise.all([
    import("@opencode-ai/core/database/v1-migration.bun"),
    import("@opencode-ai/schema/session-v1"),
    import("effect"),
  ])
  const decodeSession = Schema.decodeUnknownSync(SessionV1.SessionInfo)
  const decodeMessage = Schema.decodeUnknownSync(SessionV1.Info)
  const decodePart = Schema.decodeUnknownSync(SessionV1.Part)
  const session = decodeSession(blob.session)
  const result = V1Migration.transformSession(
    migrationInput(
      session,
      blob.messages.map((message) => decodeMessage(message)),
      blob.parts.map((part) => decodePart(part)),
    ),
  )
  return {
    session: currentSession(session, result),
    messages: currentMessages(result),
    warnings: result.warnings,
  }
}

function migrationInput(
  session: typeof SessionV1.SessionInfo.Type,
  messages: ReadonlyArray<typeof SessionV1.Info.Type>,
  parts: ReadonlyArray<typeof SessionV1.Part.Type>,
): V1Migration.TransformInput {
  const byMessage = new Map(messages.map((message) => [message.id, message] as const))
  return {
    session: {
      id: session.id,
      project_id: session.projectID,
      workspace_id: session.workspaceID ?? null,
      parent_id: session.parentID ?? null,
      fork_session_id: null,
      fork_boundary: null,
      slug: session.slug,
      directory: session.directory,
      path: session.path ?? null,
      title: session.title ?? null,
      version: session.version,
      share_url: session.share?.url ?? null,
      summary_additions: session.summary?.additions ?? null,
      summary_deletions: session.summary?.deletions ?? null,
      summary_files: session.summary?.files ?? null,
      summary_diffs: session.summary?.diffs ? [...session.summary.diffs] : null,
      metadata: session.metadata ?? null,
      cost: session.cost ?? 0,
      tokens_input: session.tokens?.input ?? 0,
      tokens_output: session.tokens?.output ?? 0,
      tokens_reasoning: session.tokens?.reasoning ?? 0,
      tokens_cache_read: session.tokens?.cache.read ?? 0,
      tokens_cache_write: session.tokens?.cache.write ?? 0,
      revert: null,
      permission: session.permission ?? null,
      agent: session.agent ?? null,
      model: session.model ?? null,
      time_created: session.time.created,
      time_updated: session.time.updated,
      time_compacting: session.time.compacting ?? null,
      time_archived: session.time.archived ?? null,
      time_suspended: null,
      resume_attempts: 0,
    },
    messages: messages.map((message) => ({
      id: message.id,
      session_id: message.sessionID,
      time_created: message.time.created,
      time_updated: completed(message) ?? message.time.created,
      data: JSON.stringify(message),
    })),
    parts: parts.map((part) => {
      const message = byMessage.get(part.messageID)
      return {
        id: part.id,
        message_id: part.messageID,
        session_id: part.sessionID,
        time_created: message?.time.created ?? session.time.created,
        time_updated: (message ? completed(message) : undefined) ?? message?.time.created ?? session.time.updated,
        data: JSON.stringify(part),
      }
    }),
  }
}

function currentSession(session: typeof SessionV1.SessionInfo.Type, result: V1Migration.TransformResult): SessionInfo {
  return {
    id: session.id,
    projectID: session.projectID,
    ...(session.parentID ? { parentID: session.parentID } : {}),
    ...(result.session.agent ? { agent: result.session.agent } : {}),
    ...(result.session.model ? { model: result.session.model } : {}),
    cost: result.session.cost ?? 0,
    tokens: {
      input: result.session.tokens_input ?? 0,
      output: result.session.tokens_output ?? 0,
      reasoning: result.session.tokens_reasoning ?? 0,
      cache: {
        read: result.session.tokens_cache_read ?? 0,
        write: result.session.tokens_cache_write ?? 0,
      },
    },
    ...(session.title ? { title: session.title } : {}),
    location: { directory: session.directory },
    ...(session.path ? { subpath: session.path } : {}),
    time: {
      created: session.time.created,
      updated: session.time.updated,
      ...(session.time.archived ? { archived: session.time.archived } : {}),
    },
  }
}

function parseShareBlob(data: Share.Data[]) {
  let session: Share.Session | undefined
  let current: Share.Messages | undefined
  let diffs: Share.SessionDiff[] = []
  let models: Share.Model[] = []
  const messages: Share.StoredMessage[] = []
  const parts: Share.StoredPart[] = []

  data.forEach((item) => {
    if (item.type === "session") session = item.data
    if (item.type === "messages") current = item.data
    if (item.type === "message") messages.push(item.data)
    if (item.type === "part") parts.push(item.data)
    if (item.type === "session_diff") diffs = item.data
    if (item.type === "model") models = item.data
  })

  if (!session) throw new Error("Share blob is missing its Session")
  if ("location" in session) {
    if (!current) throw new Error("Current share blob is missing its message batch")
    return { type: "current" as const, session, messages: current.messages, diffs, models }
  }
  if (current) throw new Error("Stored share blob has an unexpected current message batch")
  return { type: "stored" as const, session, messages, parts, diffs, models }
}

function currentMessages(result: V1Migration.TransformResult): SessionMessageInfo[] {
  return result.messages.map((row) => {
    const message: unknown = { id: row.id, type: row.type, ...row.data }
    if (!isCurrentMessage(message)) throw new Error("Share migration produced an invalid message")
    return message
  })
}

function isCurrentMessage(input: unknown): input is SessionMessageInfo {
  if (!input || typeof input !== "object") return false
  if (!("id" in input) || typeof input.id !== "string") return false
  if (!("type" in input) || typeof input.type !== "string") return false
  if (!("time" in input) || !input.time || typeof input.time !== "object") return false
  return "created" in input.time && typeof input.time.created === "number"
}

function currentDiffs(diffs: Share.SessionDiff[]): FileDiffInfo[] {
  return diffs.map((diff) => ({
    file: diff.file,
    patch: diff.patch,
    additions: diff.additions,
    deletions: diff.deletions,
    status:
      diff.status ??
      (diff.additions > 0 && diff.deletions === 0
        ? "added"
        : diff.deletions > 0 && diff.additions === 0
          ? "deleted"
          : "modified"),
  }))
}

function completed(message: typeof SessionV1.Info.Type) {
  return "completed" in message.time ? message.time.completed : undefined
}
