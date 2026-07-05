import { expect, test } from "bun:test"
import { createComponent } from "solid-js"
import { render } from "solid-js/web"
import { TextReveal } from "./text-reveal"

function frames() {
  const callbacks = new Map<number, FrameRequestCallback>()
  const originalRequest = globalThis.requestAnimationFrame
  const originalCancel = globalThis.cancelAnimationFrame
  let id = 0
  globalThis.requestAnimationFrame = (callback) => {
    callbacks.set(++id, callback)
    return id
  }
  globalThis.cancelAnimationFrame = (frame) => {
    callbacks.delete(frame)
  }
  return {
    callbacks,
    restore() {
      globalThis.requestAnimationFrame = originalRequest
      globalThis.cancelAnimationFrame = originalCancel
    },
  }
}

test("mounts without a spurious swap and cancels its readiness frame on disposal", () => {
  const scheduled = frames()
  const descriptor = Object.getOwnPropertyDescriptor(document, "fonts")
  Object.defineProperty(document, "fonts", { configurable: true, value: undefined })

  try {
    const container = document.createElement("div")
    const dispose = render(() => createComponent(TextReveal, { text: "Hello" }), container)
    expect(container.querySelector('[data-component="text-reveal"]')?.getAttribute("data-swapping")).toBe("false")
    expect(scheduled.callbacks.size).toBe(1)
    dispose()
    expect(scheduled.callbacks.size).toBe(0)
  } finally {
    if (descriptor) Object.defineProperty(document, "fonts", descriptor)
    else Reflect.deleteProperty(document, "fonts")
    scheduled.restore()
  }
})

test("does not schedule readiness work when fonts settle after disposal", async () => {
  const scheduled = frames()
  const descriptor = Object.getOwnPropertyDescriptor(document, "fonts")
  const pending = Promise.withResolvers<FontFaceSet>()
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: pending.promise } })

  try {
    const container = document.createElement("div")
    const dispose = render(() => createComponent(TextReveal, { text: "Hello" }), container)
    dispose()
    pending.resolve({} as FontFaceSet)
    await pending.promise
    await Promise.resolve()
    expect(scheduled.callbacks.size).toBe(0)
  } finally {
    if (descriptor) Object.defineProperty(document, "fonts", descriptor)
    else Reflect.deleteProperty(document, "fonts")
    scheduled.restore()
  }
})
