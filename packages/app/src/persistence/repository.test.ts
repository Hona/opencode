import { describe, expect, test, vi } from "bun:test"
import { createRepository, type DurableRepository } from "./repository"

describe("checkpoint repository", () => {
  test("serializes only the latest value at the checkpoint deadline", async () => {
    vi.useFakeTimers()
    try {
      const values: string[] = []
      const durable: DurableRepository = {
        read: async () => null,
        commit: async (input) => {
          values.push(input.value)
        },
        remove: async () => undefined,
        putBlob: async (bytes) => ({ digest: "digest", byteLength: bytes.byteLength }),
        readBlob: async () => null,
        drain: async () => undefined,
      }
      const repository = createRepository(durable)
      let serialized = 0
      const address = { storage: "global", key: "prompt" }

      repository.commit({ address, value: () => `${++serialized}:first` })
      repository.commit({ address, value: () => `${++serialized}:latest` })
      expect(serialized).toBe(0)

      vi.advanceTimersByTime(500)
      await Promise.resolve()
      await Promise.resolve()
      expect(values).toEqual(["1:latest"])
    } finally {
      vi.useRealTimers()
    }
  })
})
