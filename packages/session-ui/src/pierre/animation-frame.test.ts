import { expect, test } from "bun:test"
import { createAnimationFrameScope } from "./animation-frame"

test("animation frame scopes cancel and guard callbacks from older requests", () => {
  const callbacks = new Map<number, FrameRequestCallback>()
  const cancelled: number[] = []
  const called: string[] = []
  let id = 0
  const scope = createAnimationFrameScope({
    request: (callback) => {
      id++
      callbacks.set(id, callback)
      return id
    },
    cancel: (frame) => cancelled.push(frame),
  })

  const first = scope.start()
  first(() => called.push("first"))
  const stale = callbacks.get(1)!
  const second = scope.start()
  second(() => called.push("second"))

  expect(cancelled).toEqual([1])
  stale(0)
  callbacks.get(2)!(0)
  expect(called).toEqual(["second"])

  const third = scope.start()
  third(() => called.push("third"))
  const disposed = callbacks.get(3)!
  scope.clear()
  disposed(0)

  expect(cancelled).toEqual([1, 3])
  expect(called).toEqual(["second"])
})
