import type { SessionMessageUser } from "@opencode/client/promise"
import { useComposerState } from "@/composer/persistence"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useLanguage } from "@/runtime/i18n/language"
import { commentContextItem, readPromptPresentation } from "@/composer/comment-note"
import { extractPromptComments, extractPromptFromMessage } from "@/composer/prompt"
import { promptLength } from "@/composer/prompt-parts"
import { buildPromptRequest } from "@/composer/request"
import { contextItemKey } from "@/composer/schema"
import { showToast } from "@/shell/notifications/toast"
import { mentionedPromptParts, queuedPromptAttachments, type QueuedPrompt } from "./composer/queue"
import type { SessionModel } from "./model"

export function createSessionRevert(input: {
  session: SessionModel
  setActiveMessage: (message: SessionMessageUser | undefined) => void
}) {
  const prompt = useComposerState()
  const server = useServerSDK()
  const data = useData()
  const location = useWorkspaceLocation()
  const language = useLanguage()

  const request = async <A>(action: () => Promise<A>) =>
    action()
      .then(() => true)
      .catch((error) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        })

        return false
      })

  const restore = (target: ReturnType<typeof prompt.capture>, message: SessionMessageUser) => {
    target.set(
      extractPromptFromMessage(message, {
        directory: location().directory,
      }),
    )
    target.context.replaceComments(extractPromptComments(message).map(commentContextItem))
  }

  const stage = async (message: SessionMessageUser, previous: SessionMessageUser | undefined) => {
    const sessionID = input.session.identity.params.id

    if (!sessionID) return
    const owner = input.session.ownership.capture()
    const target = prompt.capture()

    // An undelivered prompt has no history to rewind. Withdraw it like the TUI
    // instead of interrupting the work it is waiting behind. The draft is
    // rebuilt before cancelling, which would otherwise lose context for good.
    if (data.session.input.has(sessionID, message.id)) {
      const item = data.session.pending
        .list(sessionID)
        .find((entry): entry is QueuedPrompt => entry.type === "user" && entry.id === message.id)

      const draft = item && pendingDraft(item, location().directory)

      if (!draft) {
        showToast({ title: language.t("session.revert.pendingUnavailable") })

        return
      }

      if (!(await request(() => server.api.session.inbox.cancel({ sessionID, inboxID: message.id })))) return
      target.set(draft.prompt, promptLength(draft.prompt))
      target.context.replaceComments(draft.comments)
      owner.run(() => input.setActiveMessage(previous))

      return
    }

    // Interrupt acknowledges before the execution settles, and staging a busy Session fails. The
    // local status can lag the server either way, so always settle first; both are idle no-ops.
    // Like the TUI, stop at the first failure instead of waiting on work that was never interrupted.
    if (!(await request(() => server.api.session.interrupt({ sessionID })))) return

    if (!(await request(() => server.api.session.wait({ sessionID })))) return

    if (!(await request(() => server.api.session.revert.stage({ sessionID, messageID: message.id })))) return
    // Reverting to a previous prompt discards the pending queue (and pending
    // steers): they were written against the history being rewound. Cancel
    // the authoritative inbox merged with the local snapshot, fire-and-forget
    // so a slow request cannot delay restoring the composer. The cutoff keeps
    // the asynchronous sweep away from prompts admitted after the revert; an
    // old admission still in flight when the list is fetched can survive it,
    // and fully closing that race needs a server-side revert-discards-inbox
    // rule.
    const cutoff = Date.now()

    const local = data.session.pending
      .list(sessionID)
      .filter((item) => item.type === "user")
      .map((item) => item.id)

    void server.api.session.inbox
      .list({ sessionID })
      .then((rows) => rows.filter((row) => row.type === "user" && row.time.created <= cutoff).map((row) => row.id))
      .catch(() => [])
      .then((authoritative) => {
        new Set([...local, ...authoritative]).forEach(
          (inboxID) => void server.api.session.inbox.cancel({ sessionID, inboxID }).catch(() => undefined),
        )
      })
    restore(target, message)
    owner.run(() => input.setActiveMessage(previous))
  }

  const to = async (messageID: string) => {
    const messages = input.session.history.userMessages()
    const index = messages.findIndex((message) => message.id === messageID)
    const message = messages[index]

    if (!message) return
    await stage(message, messages[index - 1])
  }

  const undo = async () => {
    const messages = input.session.history.userMessages()
    const reverted = input.session.data.revertMessageID()
    const boundary = reverted ? messages.findIndex((message) => message.id === reverted) : messages.length

    if (boundary <= 0) return
    const message = messages[boundary - 1]

    if (message) await stage(message, messages[boundary - 2])
  }

  const redo = async () => {
    const sessionID = input.session.identity.params.id
    const reverted = input.session.data.revertMessageID()

    if (!sessionID || !reverted) return
    const messages = input.session.history.userMessages()
    const boundary = messages.findIndex((message) => message.id === reverted)

    if (boundary < 0) return
    const next = messages[boundary + 1]

    if (next) {
      await stage(next, messages[boundary])

      return
    }

    const owner = input.session.ownership.capture()
    const target = prompt.capture()

    if (!(await request(() => server.api.session.revert.clear({ sessionID })))) return
    target.reset()
    target.context.replaceComments([])
    owner.run(() => input.setActiveMessage(messages.at(-1)))
  }

  return { to, undo, redo }
}

export type SessionRevert = ReturnType<typeof createSessionRevert>

// Restores a pending prompt as the composer content that submitted it: display text and mentions,
// attachments, and review comments. Comments regenerate the context files they attached, so any
// other unmentioned file means the composer cannot hold the prompt and the result is undefined.
function pendingDraft(item: QueuedPrompt, directory: string) {
  const presentation = readPromptPresentation(item.payload.metadata)
  const parts = mentionedPromptParts(item, presentation?.displayText ?? item.payload.text)

  if (!parts) return
  const prompt = [...parts, ...queuedPromptAttachments(item)]
  const comments = (presentation?.comments ?? []).map(commentContextItem)

  const restored = new Set(
    buildPromptRequest({
      prompt,
      context: comments.map((comment) => ({ ...comment, key: contextItemKey(comment) })),
      images: [],
      text: "",
      sessionDirectory: directory,
    }).files.flatMap((file) => (file.mention ? [] : [file.uri])),
  )

  if (item.payload.files?.some((file) => !file.mention && file.source.type === "uri" && !restored.has(file.source.uri)))
    return

  return { prompt, comments }
}
