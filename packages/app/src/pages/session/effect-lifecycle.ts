export function createInputRequestLatch(maxAttempts = 2) {
  let input: string | undefined
  let generation = 0
  let attempts = 0
  let state: "ready" | "pending" | "failed" | "complete" = "ready"

  const observe = (next: string) => {
    if (input === next) return
    input = next
    generation += 1
    attempts = 0
    state = "ready"
  }

  return {
    observe,
    run(next: string, request: () => Promise<void>, onError: (error: unknown) => void = () => {}) {
      observe(next)
      if (state === "pending" || state === "complete") return
      if (state === "failed" && attempts >= maxAttempts) return

      state = "pending"
      attempts += 1
      const owner = generation
      return Promise.resolve()
        .then(request)
        .then(
          () => {
            if (generation === owner) state = "complete"
            return true
          },
          (error) => {
            if (generation === owner) state = attempts < maxAttempts ? "ready" : "failed"
            onError(error)
            return false
          },
        )
    },
  }
}

export function createScheduledTask<T>(schedule: (callback: () => void) => T, clear: (value: T) => void) {
  let pending: T | undefined

  const cancel = () => {
    if (pending === undefined) return
    clear(pending)
    pending = undefined
  }

  return {
    cancel,
    schedule(callback: () => void) {
      cancel()
      pending = schedule(() => {
        pending = undefined
        callback()
      })
    },
  }
}
