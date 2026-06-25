export function createPromptSubmissionState<
  TContext,
  TTarget extends { context: { add: (item: TContext) => void } },
  TPrompt,
>(input: {
  target: TTarget
  prompt: TPrompt
  context: TContext[]
}) {
  let target = input.target

  return {
    prompt: input.prompt,
    context: input.context,
    target: () => target,
    retarget(next: TTarget) {
      input.context.forEach(next.context.add)
      target = next
    },
    current: (value: TTarget) => target === value,
    restore: () => ({ target, prompt: input.prompt, context: input.context }),
  }
}
