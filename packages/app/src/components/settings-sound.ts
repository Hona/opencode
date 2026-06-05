import { playSoundById } from "@/utils/sound"

const state = {
  cleanup: undefined as (() => void) | undefined,
  timeout: undefined as NodeJS.Timeout | undefined,
  run: 0,
}

export function stopDemoSound() {
  state.run += 1
  state.cleanup?.()
  clearTimeout(state.timeout)
  state.cleanup = undefined
}

export function playDemoSound(id: string | undefined) {
  stopDemoSound()
  if (!id) return

  const run = ++state.run
  state.timeout = setTimeout(() => {
    void playSoundById(id).then((cleanup) => {
      if (state.run !== run) {
        cleanup?.()
        return
      }
      state.cleanup = cleanup
    })
  }, 100)
}
