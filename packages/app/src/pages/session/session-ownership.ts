import { batch, createComputed } from "solid-js"

export function createSessionOwnership(sessionKey: () => string) {
  let current = sessionKey()
  let generation = 0
  const transition = () => {
    const next = sessionKey()
    if (next === current) return
    current = next
    generation++
  }
  createComputed(transition)

  return {
    key: () => {
      transition()
      return `${generation}:${current}`
    },
    capture() {
      transition()
      const captured = generation
      return {
        key: `${captured}:${current}`,
        current: () => {
          transition()
          return generation === captured
        },
        run<T>(action: () => T) {
          transition()
          if (generation !== captured) return
          return action()
        },
      }
    },
  }
}

export function createSessionRequestTracker() {
  const requests = new Set<string>()
  return {
    pending: (key: string) => requests.has(key),
    start(key: string) {
      if (requests.has(key)) return false
      requests.add(key)
      return true
    },
    finish: (key: string) => requests.delete(key),
  }
}

export async function loadOwnedHistory(input: {
  ownership: ReturnType<typeof createSessionOwnership>
  requests: ReturnType<typeof createSessionRequestTracker>
  loading: () => boolean
  count: () => number
  load: () => Promise<void>
}) {
  const owner = input.ownership.capture()
  if (input.loading() || !input.requests.start(owner.key)) return
  const before = input.count()
  try {
    await input.load()
  } finally {
    input.requests.finish(owner.key)
  }
  if (!owner.current() || input.count() <= before) return
  return owner
}

export function scheduleSessionRender(input: {
  ownership: ReturnType<typeof createSessionOwnership>
  render: () => void
}) {
  const owner = input.ownership.capture()
  requestAnimationFrame(() => {
    setTimeout(() => owner.run(input.render), 0)
  })
}

export async function openSessionDialog<T>(input: {
  ownership: ReturnType<typeof createSessionOwnership>
  load: () => Promise<T>
  show: (value: T) => void
}) {
  const owner = input.ownership.capture()
  const value = await input.load()
  owner.run(() => input.show(value))
}

export function sessionViewState() {
  return {
    messageId: undefined as string | undefined,
    mobileTab: "session" as "session" | "changes",
    changes: "git" as "git" | "branch" | "turn",
  }
}

export async function runSessionCommand<T>(input: {
  owner: ReturnType<ReturnType<typeof createSessionOwnership>["capture"]>
  prompt: T
  request: () => Promise<unknown>
  updatePrompt: (prompt: T) => void
  updateViewport: () => void
}) {
  await input.request()
  input.updatePrompt(input.prompt)
  input.owner.run(input.updateViewport)
}

export function completeSessionFollowup(input: {
  owner: ReturnType<ReturnType<typeof createSessionOwnership>["capture"]>
  remove: () => void
  resume?: () => void
}) {
  input.remove()
  if (input.resume) input.owner.run(input.resume)
}

export async function runPromptRollbackMutation<T, R>(input: {
  capturePrompt: () => {
    current: () => T[]
    set: (value: T[]) => void
    reset: () => void
  }
  optimistic: (prompt: { set: (value: T[]) => void; reset: () => void }) => void
  request: () => Promise<R>
  complete: (result: R) => void
  rollback: () => void
  fail: (error: unknown) => void
}) {
  const prompt = input.capturePrompt()
  const previous = prompt.current().slice()
  batch(() => input.optimistic(prompt))
  await input
    .request()
    .then(input.complete)
    .catch((error) => {
      batch(() => {
        input.rollback()
        prompt.set(previous)
      })
      input.fail(error)
    })
}
