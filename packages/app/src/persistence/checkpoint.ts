const CHECKPOINT_INTERVAL = 500

type Waiter = {
  generation: number
  resolve(): void
  reject(error: unknown): void
}

export function createCheckpointController<T>(commit: (value: T) => Promise<void>) {
  let generation = 0
  let committed = 0
  let attempted = 0
  let latest: T
  let dirtySince: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight = false
  let waiters: Waiter[] = []
  let idleWaiters: Array<() => void> = []

  const schedule = () => {
    if (timer !== undefined || inFlight || committed === generation) return
    const delay = Math.max(0, CHECKPOINT_INTERVAL - (Date.now() - (dirtySince ?? Date.now())))
    timer = setTimeout(() => {
      timer = undefined
      run()
    }, delay)
  }

  const settle = () => {
    const ready = waiters.filter((waiter) => waiter.generation <= committed)
    waiters = waiters.filter((waiter) => waiter.generation > committed)
    ready.forEach((waiter) => waiter.resolve())
  }

  const run = () => {
    if (inFlight || committed === generation) return
    inFlight = true
    attempted = generation
    const value = latest
    const attemptedSince = dirtySince
    dirtySince = undefined

    void Promise.resolve()
      .then(() => commit(value))
      .then(
        () => {
          committed = attempted
          inFlight = false
          idleWaiters.splice(0).forEach((resolve) => resolve())
          settle()
          if (committed === generation) return
          if (waiters.some((waiter) => waiter.generation > committed)) {
            run()
            return
          }
          schedule()
        },
        (error) => {
          inFlight = false
          idleWaiters.splice(0).forEach((resolve) => resolve())
          dirtySince = Math.min(attemptedSince ?? Date.now(), dirtySince ?? Number.POSITIVE_INFINITY)
          const pending = waiters
          waiters = []
          pending.forEach((waiter) => waiter.reject(error))
        },
      )
  }

  return {
    checkpoint(value: T) {
      latest = value
      generation += 1
      dirtySince ??= Date.now()
      schedule()
    },
    drain() {
      const observed = generation
      if (committed >= observed) return Promise.resolve()
      return new Promise<void>((resolve, reject) => {
        waiters.push({ generation: observed, resolve, reject })
        if (timer !== undefined) {
          clearTimeout(timer)
          timer = undefined
        }
        run()
      })
    },
    discard() {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      generation = committed
      dirtySince = undefined
      const pending = waiters
      waiters = []
      pending.forEach((waiter) => waiter.resolve())
    },
    idle() {
      if (!inFlight) return Promise.resolve()
      return new Promise<void>((resolve) => idleWaiters.push(resolve))
    },
  }
}
