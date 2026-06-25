export function createPromptSubmissionState<
  TContext,
  TTarget extends {
    context: { add: (item: TContext) => void }
    current: () => TPrompt
    reset: () => void
  },
  TPrompt,
>(input: {
  target: TTarget
  prompt: TPrompt
  context: TContext[]
}) {
  let target = input.target
  let cleared: TPrompt | undefined

  return {
    prompt: input.prompt,
    context: input.context,
    target: () => target,
    clear() {
      target.reset()
      cleared = target.current()
    },
    retarget(next: TTarget) {
      input.context.forEach(next.context.add)
      target = next
    },
    current: (value: TTarget) => target === value,
    restore() {
      if (cleared !== undefined && target.current() !== cleared) return
      return { target, prompt: input.prompt, context: input.context }
    },
  }
}
