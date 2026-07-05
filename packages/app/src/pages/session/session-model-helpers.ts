import type { UserMessage } from "@opencode-ai/sdk/v2"

export type ChangeMode = "git" | "branch" | "turn"

type Local = {
  session: {
    reset(): void
    restore(msg: UserMessage): void
  }
}

export const resetSessionModel = (local: Local) => {
  local.session.reset()
}

export const syncSessionModel = (local: Local, msg: UserMessage) => {
  local.session.restore(msg)
}

export const effectiveChangeMode = (selected: ChangeMode, options: ChangeMode[]) =>
  options.includes(selected) ? selected : (options[0] ?? selected)
