import { describe, expect, test, vi } from "bun:test"
import { createCheckpointController } from "./checkpoint"

const tick = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe("checkpoint controller", () => {
  test("checkpoints no later than 500ms from the first dirty mutation", async () => {
    vi.useFakeTimers()
    try {
      const writes: string[] = []
      const checkpoint = createCheckpointController<string>(async (value) => {
        writes.push(value)
      })

      checkpoint.checkpoint("first")
      vi.advanceTimersByTime(250)
      checkpoint.checkpoint("latest")
      vi.advanceTimersByTime(249)
      await tick()
      expect(writes).toEqual([])

      vi.advanceTimersByTime(1)
      await tick()
      expect(writes).toEqual(["latest"])
    } finally {
      vi.useRealTimers()
    }
  })

  test("allows one commit in flight and coalesces to the latest state", async () => {
    vi.useFakeTimers()
    try {
      const first = Promise.withResolvers<void>()
      const writes: string[] = []
      const checkpoint = createCheckpointController<string>((value) => {
        writes.push(value)
        return writes.length === 1 ? first.promise : Promise.resolve()
      })

      checkpoint.checkpoint("first")
      vi.advanceTimersByTime(500)
      await tick()
      checkpoint.checkpoint("second")
      checkpoint.checkpoint("latest")
      vi.advanceTimersByTime(500)
      await tick()
      expect(writes).toEqual(["first"])

      first.resolve()
      await tick()
      vi.advanceTimersByTime(0)
      await tick()
      expect(writes).toEqual(["first", "latest"])
    } finally {
      vi.useRealTimers()
    }
  })

  test("keeps failed state dirty so drain retries it", async () => {
    vi.useFakeTimers()
    try {
      const writes: string[] = []
      const checkpoint = createCheckpointController<string>((value) => {
        writes.push(value)
        return writes.length === 1 ? Promise.reject(new Error("failed")) : Promise.resolve()
      })

      checkpoint.checkpoint("state")
      vi.advanceTimersByTime(500)
      await tick()
      expect(writes).toEqual(["state"])

      await checkpoint.drain()
      expect(writes).toEqual(["state", "state"])
    } finally {
      vi.useRealTimers()
    }
  })

  test("drain waits only for the generation it observed", async () => {
    const first = Promise.withResolvers<void>()
    const writes: string[] = []
    const checkpoint = createCheckpointController<string>((value) => {
      writes.push(value)
      return first.promise
    })

    checkpoint.checkpoint("observed")
    const drained = checkpoint.drain()
    checkpoint.checkpoint("later")
    first.resolve()
    await drained

    expect(writes).toEqual(["observed"])
  })
})
