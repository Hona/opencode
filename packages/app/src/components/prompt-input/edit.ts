import type { Prompt } from "@/context/prompt"
import type { FollowupDraft } from "./submit"

export type PromptInputEdit = {
  id: string
  prompt: Prompt
  context: FollowupDraft["context"]
}

export type PromptInputEditCommand = {
  load: (edit: PromptInputEdit) => void
}

export function createPromptInputEditSlot(current: () => PromptInputEdit | undefined) {
  let command: PromptInputEditCommand | undefined

  return {
    mount(next: PromptInputEditCommand | undefined) {
      command = next
      if (!command) return
      const edit = current()
      if (edit) command.load(edit)
    },
    load(edit: PromptInputEdit) {
      command?.load(edit)
    },
  }
}

export function createPromptInputEditCommand(input: {
  apply: (edit: PromptInputEdit) => void
  focus: (edit: PromptInputEdit) => void
  loaded: () => void
  schedule: (callback: () => void) => number
  cancel: (id: number) => void
}) {
  let frame: number | undefined
  const cancel = () => {
    if (frame === undefined) return
    input.cancel(frame)
    frame = undefined
  }

  return {
    load(edit: PromptInputEdit) {
      cancel()
      input.apply(edit)
      frame = input.schedule(() => {
        frame = undefined
        input.focus(edit)
      })
      input.loaded()
    },
    cancel,
    dispose: cancel,
  }
}
