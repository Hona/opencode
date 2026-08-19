import type { FileDiffInfo, SessionMessageInfo } from "@opencode-ai/client/promise"
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

  const { V1Migration } = await import("@opencode-ai/core/database/v1-migration.bun")
  const migrated = V1Migration.transformSnapshot(blob)
  return {
    session: migrated.session,
    messages: currentMessages(migrated.messages),
    diffs: currentDiffs(blob.diffs),
    models: blob.models,
    warnings: migrated.warnings,
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

function currentMessages(input: unknown): SessionMessageInfo[] {
  if (!Array.isArray(input) || !input.every(isCurrentMessage))
    throw new Error("Share migration produced invalid messages")
  return input
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
