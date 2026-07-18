import { describe, expect, test, beforeEach, afterEach, vi } from "bun:test"
import { BufferedStore } from "./store"

class MemoryStore {
  public data = new Map<string, unknown>()
  get(key: string) {
    return this.data.get(key)
  }
  set(key: string, value: unknown) {
    this.data.set(key, value)
  }
  delete(key: string) {
    this.data.delete(key)
  }
}

describe("BufferedStore", () => {
  test("returns pending value before flush", () => {
    const underlying = new MemoryStore()
    const store = new BufferedStore(underlying as any, 100)

    store.set("theme", "dark")

    // MemoryStore hasn't been updated yet before flush
    expect(underlying.data.get("theme")).toBeUndefined()

    // But BufferedStore returns the pending write immediately
    expect(store.get("theme")).toBe("dark")
  })

  test("flushes pending writes to underlying store on flush()", () => {
    const underlying = new MemoryStore()
    const store = new BufferedStore(underlying as any, 100)

    store.set("key1", "value1")
    store.set("key2", "value2")
    store.flush()

    expect(underlying.data.get("key1")).toBe("value1")
    expect(underlying.data.get("key2")).toBe("value2")
  })

  test("buffers delete operations until flush()", () => {
    const underlying = new MemoryStore()
    underlying.set("key1", "value1")

    const store = new BufferedStore(underlying as any, 100)
    store.delete("key1")

    // Still in underlying before flush
    expect(underlying.data.get("key1")).toBe("value1")
    // Buffered as deleted
    expect(store.get("key1")).toBeUndefined()

    store.flush()
    expect(underlying.data.has("key1")).toBe(false)
  })
})
