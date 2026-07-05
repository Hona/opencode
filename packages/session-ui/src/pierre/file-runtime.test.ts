import { expect, test } from "bun:test"
import { clearReadyWatcher, createReadyWatcher, notifyShadowReady } from "./file-runtime"

test("clearing a ready watcher cancels and guards its pending readiness callback", () => {
  const callbacks = new Map<number, FrameRequestCallback>()
  const cancelled: number[] = []
  let id = 0
  let called = 0
  const state = createReadyWatcher({
    request: (callback) => {
      id++
      callbacks.set(id, callback)
      return id
    },
    cancel: (frame) => cancelled.push(frame),
  })

  notifyShadowReady({
    state,
    container: {} as HTMLElement,
    getRoot: () => ({}) as ShadowRoot,
    isReady: () => true,
    settleFrames: 1,
    onReady: () => called++,
  })
  const stale = callbacks.get(1)!

  clearReadyWatcher(state)
  stale(0)

  expect(cancelled).toEqual([1])
  expect(called).toBe(0)
})
