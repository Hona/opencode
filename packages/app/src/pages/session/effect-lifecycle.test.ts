import { describe, expect, test } from "bun:test"
import { createInputRequestLatch, createScheduledTask } from "./effect-lifecycle"

describe("input request latch", () => {
  test("allows one bounded retry before blocking the same failed input", async () => {
    const latch = createInputRequestLatch(2)
    const errors: unknown[] = []
    const failure = new Error("history failed")
    let calls = 0

    const request = () =>
      latch.run(
        "session-a:cursor-a",
        async () => {
          calls += 1
          throw failure
        },
        (error) => errors.push(error),
      )

    expect(await request()).toBe(false)
    expect(await request()).toBe(false)
    expect(request()).toBeUndefined()
    expect(calls).toBe(2)
    expect(errors).toEqual([failure, failure])
  })

  test("allows another request after meaningful input changes", async () => {
    const latch = createInputRequestLatch()
    let calls = 0

    await latch.run("session-a:target-a:cursor-a", async () => {
      calls += 1
      throw new Error("history failed")
    })
    latch.observe("session-a:target-b:cursor-a")
    await latch.run("session-a:target-a:cursor-a", async () => {
      calls += 1
    })

    expect(calls).toBe(2)
  })

  test("does not let a late failure take ownership from newer input", async () => {
    const latch = createInputRequestLatch()
    const pending = Promise.withResolvers<void>()

    const old = latch.run("session-a:cursor-a", () => pending.promise)
    expect(await latch.run("session-b:cursor-b", async () => {})).toBe(true)
    pending.reject(new Error("old request failed"))
    expect(await old).toBe(false)

    expect(latch.run("session-b:cursor-b", async () => {})).toBeUndefined()
  })

  test("does not repeat a successful request until its input changes", async () => {
    const latch = createInputRequestLatch()

    expect(await latch.run("session-a:cursor-a", async () => {})).toBe(true)
    expect(latch.run("session-a:cursor-a", async () => {})).toBeUndefined()
    expect(await latch.run("session-a:cursor-b", async () => {})).toBe(true)
  })
})

describe("scheduled task", () => {
  test("cancels replaced and explicitly cleared work", () => {
    const callbacks = new Map<number, () => void>()
    const cancelled: number[] = []
    let id = 0
    const task = createScheduledTask(
      (callback) => {
        id += 1
        callbacks.set(id, callback)
        return id
      },
      (value) => {
        cancelled.push(value)
        callbacks.delete(value)
      },
    )
    const calls: string[] = []

    task.schedule(() => calls.push("old"))
    task.schedule(() => calls.push("current"))
    expect(cancelled).toEqual([1])

    callbacks.get(2)?.()
    task.schedule(() => calls.push("cancelled"))
    task.cancel()

    expect(calls).toEqual(["current"])
    expect(cancelled).toEqual([1, 3])
  })
})
