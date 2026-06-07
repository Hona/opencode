export type SidecarSettlement = { code: number; expected: boolean }

export function createSidecarLifecycle() {
  let expected = false
  let resolve!: (settlement: SidecarSettlement) => void
  const exit = new Promise<SidecarSettlement>((done) => {
    resolve = done
  })
  return {
    exit,
    stopping: () => {
      expected = true
    },
    exited: (code: number) => resolve({ code, expected }),
  }
}

export function isUnexpectedCurrentSidecar<T>(current: T | null, exited: T, settlement: SidecarSettlement) {
  return current === exited && !settlement.expected
}
