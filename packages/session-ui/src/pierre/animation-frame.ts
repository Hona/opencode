type AnimationFrameScheduler = {
  request: (callback: FrameRequestCallback) => number
  cancel: (frame: number) => void
}

export function createAnimationFrameScope(
  scheduler: AnimationFrameScheduler = {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (frame) => cancelAnimationFrame(frame),
  },
) {
  const frames = new Set<number>()
  let generation = 0

  const clear = () => {
    generation++
    frames.forEach((frame) => scheduler.cancel(frame))
    frames.clear()
  }

  const start = () => {
    clear()
    const current = generation

    return (callback: FrameRequestCallback) => {
      if (current !== generation) return
      const frame = scheduler.request((time) => {
        frames.delete(frame)
        if (current !== generation) return
        callback(time)
      })
      frames.add(frame)
    }
  }

  return { start, clear }
}
