import z from "zod"

const record = z.custom<Record<string, unknown>>(
  (value) => !!value && typeof value === "object" && !Array.isArray(value),
)
const time = z
  .object({ created: z.number(), updated: z.number().optional(), archived: z.number().optional() })
  .passthrough()
const diff = z
  .object({
    file: z.string(),
    patch: z.string().optional(),
    before: z.string().optional(),
    after: z.string().optional(),
    additions: z.number(),
    deletions: z.number(),
    status: z.enum(["added", "deleted", "modified"]).optional(),
  })
  .passthrough()
const summaryDiff = diff.extend({ file: z.string().optional() })

const session = z
  .object({
    id: z.string(),
    directory: z.string(),
    version: z.string(),
    title: z.string().optional(),
    parentID: z.string().optional(),
    time: time.extend({ updated: z.number() }),
  })
  .passthrough()

const messageBase = {
  id: z.string(),
  sessionID: z.string(),
  time,
}
const userMessage = z
  .object({
    ...messageBase,
    role: z.literal("user"),
    agent: z.string().optional(),
    model: z.object({ providerID: z.string(), modelID: z.string() }).passthrough().optional(),
    summary: z
      .object({ title: z.string().optional(), diffs: z.array(summaryDiff) })
      .passthrough()
      .optional(),
  })
  .passthrough()
const assistantMessage = z
  .object({
    ...messageBase,
    role: z.literal("assistant"),
    parentID: z.string(),
    providerID: z.string(),
    modelID: z.string(),
    agent: z.string().optional(),
    error: z
      .object({ name: z.string(), data: z.object({ message: z.unknown().optional() }).passthrough().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough()
const message = z.discriminatedUnion("role", [userMessage, assistantMessage])

const partBase = {
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
}
const textPart = z.object({ ...partBase, type: z.literal("text"), text: z.string() }).passthrough()
const reasoningPart = z.object({ ...partBase, type: z.literal("reasoning"), text: z.string() }).passthrough()
const sourceText = z.object({ value: z.string(), start: z.number(), end: z.number() }).passthrough()
const fileSource = z.discriminatedUnion("type", [
  z.object({ type: z.literal("file"), text: sourceText, path: z.string() }).passthrough(),
  z
    .object({
      type: z.literal("symbol"),
      text: sourceText,
      path: z.string(),
      range: z
        .object({
          start: z.object({ line: z.number(), character: z.number() }).passthrough(),
          end: z.object({ line: z.number(), character: z.number() }).passthrough(),
        })
        .passthrough(),
      name: z.string(),
      kind: z.number(),
    })
    .passthrough(),
  z.object({ type: z.literal("resource"), text: sourceText, clientName: z.string(), uri: z.string() }).passthrough(),
])
const filePart = z
  .object({
    ...partBase,
    type: z.literal("file"),
    mime: z.string(),
    filename: z.string().optional(),
    url: z.string(),
    source: fileSource.optional(),
  })
  .passthrough()
const agentPart = z
  .object({
    ...partBase,
    type: z.literal("agent"),
    name: z.string(),
    source: z.object({ value: z.string().optional(), start: z.number(), end: z.number() }).passthrough().optional(),
  })
  .passthrough()
const pendingTool = z.object({ status: z.literal("pending"), input: record, raw: z.string().optional() }).passthrough()
const runningTool = z
  .object({
    status: z.literal("running"),
    input: record,
    title: z.string().optional(),
    metadata: record.optional(),
    time: z.object({ start: z.number() }).passthrough().optional(),
  })
  .passthrough()
const completedTool = z
  .object({
    status: z.literal("completed"),
    input: record,
    output: z.string(),
    title: z.string().optional(),
    metadata: record.optional(),
    time: z.object({ start: z.number(), end: z.number(), compacted: z.number().optional() }).passthrough().optional(),
    attachments: z.array(filePart).optional(),
  })
  .passthrough()
const failedTool = z
  .object({
    status: z.literal("error"),
    input: record,
    error: z.string(),
    output: z.string().optional(),
    metadata: record.optional(),
    time: z.object({ start: z.number(), end: z.number() }).passthrough().optional(),
  })
  .passthrough()
const toolPart = z
  .object({
    ...partBase,
    type: z.literal("tool"),
    callID: z.string().optional(),
    tool: z.string(),
    state: z.discriminatedUnion("status", [pendingTool, runningTool, completedTool, failedTool]),
  })
  .passthrough()
const passivePart = z
  .object({
    ...partBase,
    type: z.enum(["subtask", "step-start", "step-finish", "snapshot", "patch", "retry", "compaction"]),
  })
  .passthrough()
const part = z.discriminatedUnion("type", [textPart, reasoningPart, filePart, agentPart, toolPart, passivePart])
const model = z.object({ id: z.string(), name: z.string() }).passthrough()

export const ShareData = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session"), data: session }).passthrough(),
  z.object({ type: z.literal("message"), data: message }).passthrough(),
  z.object({ type: z.literal("part"), data: part }).passthrough(),
  z.object({ type: z.literal("session_diff"), data: z.array(diff) }).passthrough(),
  z.object({ type: z.literal("model"), data: z.array(model) }).passthrough(),
])

export type ShareData = z.infer<typeof ShareData>
export type ShareSession = z.infer<typeof session>
export type ShareMessage = z.infer<typeof message>
export type SharePart = z.infer<typeof part>
export type ShareFileDiff = z.infer<typeof diff>
export type ShareModel = z.infer<typeof model>
