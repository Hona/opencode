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

  test("reads the latest pending value before its checkpoint", async () => {
    let stored = "old"
    const durable: DurableRepository = {
      read: async () => stored,
      commit: async (input) => {
        stored = input.value
      },
      remove: async () => undefined,
      putBlob: async (bytes) => ({ digest: "digest", byteLength: bytes.byteLength }),
      readBlob: async () => null,
      drain: async () => undefined,
    }
    const repository = createRepository(durable)
    const address = { storage: "global", key: "prompt" }

    repository.commit({ address, value: "new" })

    expect(await repository.read(address)).toBe("new")
    expect(stored).toBe("old")
    await repository.drain()
  })

  test("does not recreate a document when removal overlaps a commit", async () => {
    vi.useFakeTimers()
    try {
      const first = Promise.withResolvers<void>()
      let stored: string | null = null
      let commits = 0
      const durable: DurableRepository = {
        read: async () => stored,
        commit: async (input) => {
          commits++
          if (commits === 1) await first.promise
          stored = input.value
        },
        remove: async () => {
          stored = null
        },
        putBlob: async (bytes) => ({ digest: "digest", byteLength: bytes.byteLength }),
        readBlob: async () => null,
        drain: async () => undefined,
      }
      const repository = createRepository(durable)
      const address = { storage: "global", key: "prompt" }

      repository.commit({ address, value: "deleted" })
      vi.advanceTimersByTime(500)
      await Promise.resolve()
      const removing = repository.remove(address)
      first.resolve()
      await removing
      vi.advanceTimersByTime(500)
      await Promise.resolve()

      expect(await repository.read(address)).toBeNull()
      expect(commits).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
