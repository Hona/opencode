import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"

type PersistTestingType = typeof import("./persist").PersistTesting
type PersistType = typeof import("./persist").Persist
type RemovePersistedType = typeof import("./persist").removePersisted

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  readonly events: string[] = []
  readonly calls = { get: 0, set: 0, remove: 0 }

  clear() {
    this.values.clear()
  }

  get length() {
    return this.values.size
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null
  }

  getItem(key: string) {
    this.calls.get += 1
    this.events.push(`get:${key}`)
    if (key.startsWith("opencode.throw")) throw new Error("storage get failed")
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.calls.set += 1
    this.events.push(`set:${key}`)
    if (key.startsWith("opencode.quota")) throw new DOMException("quota", "QuotaExceededError")
    if (key.startsWith("opencode.throw")) throw new Error("storage set failed")
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.calls.remove += 1
    this.events.push(`remove:${key}`)
    if (key.startsWith("opencode.throw")) throw new Error("storage remove failed")
    this.values.delete(key)
  }
}

const storage = new MemoryStorage()

let persistTesting: PersistTestingType
let Persist: PersistType
let removePersisted: RemovePersistedType

beforeAll(async () => {
  mock.module("@/context/platform", () => ({
    usePlatform: () => ({ platform: "web" }),
  }))

  const mod = await import("./persist")
  persistTesting = mod.PersistTesting
  Persist = mod.Persist
  removePersisted = mod.removePersisted
})

beforeEach(() => {
  storage.clear()
  storage.events.length = 0
  storage.calls.get = 0
  storage.calls.set = 0
  storage.calls.remove = 0
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  })
})

describe("persist localStorage resilience", () => {
  test("does not cache values as persisted when quota write and eviction fail", () => {
    const storageApi = persistTesting.localStorageWithPrefix("opencode.quota.scope")
    storageApi.setItem("value", '{"value":1}')

    expect(storage.getItem("opencode.quota.scope:value")).toBeNull()
    expect(storageApi.getItem("value")).toBeNull()
  })

  test("disables only the failing scope when storage throws", () => {
    const bad = persistTesting.localStorageWithPrefix("opencode.throw.scope")
    bad.setItem("value", '{"value":1}')

    const before = storage.calls.set
    bad.setItem("value", '{"value":2}')
    expect(storage.calls.set).toBe(before)
    expect(bad.getItem("value")).toBeNull()

    const healthy = persistTesting.localStorageWithPrefix("opencode.safe.scope")
    healthy.setItem("value", '{"value":3}')
    expect(storage.getItem("opencode.safe.scope:value")).toBe('{"value":3}')
  })

  test("failing fallback scope does not poison direct storage scope", () => {
    const broken = persistTesting.localStorageWithPrefix("opencode.throw.scope2")
    broken.setItem("value", '{"value":1}')

    const direct = persistTesting.localStorageDirect()
    direct.setItem("direct-value", '{"value":5}')

    expect(storage.getItem("direct-value")).toBe('{"value":5}')
  })

  test("normalizer rejects malformed JSON payloads", () => {
    const result = persistTesting.normalize({ value: "ok" }, '{"value":"\\x"}')
    expect(result).toBeUndefined()
  })

  test("workspace storage sanitizes Windows filename characters", () => {
    const result = persistTesting.workspaceStorage("C:\\Users\\foo")

    expect(result).toStartWith("opencode.workspace.")
    expect(result.endsWith(".dat")).toBeTrue()
    expect(/[:\\/]/.test(result)).toBeFalse()
  })

  test("workspace storage collapses equivalent directory spellings", () => {
    expect(persistTesting.workspaceStorage("C:\\Users\\foo\\")).toBe(
      persistTesting.workspaceStorage("c:/users/foo"),
    )
    expect(persistTesting.workspaceLegacyStorage("C:\\Users\\foo\\").length).toBeGreaterThan(1)
  })

  test("workspace legacy storage probes slash and drive-letter variants", () => {
    const names = persistTesting.workspaceLegacyStorage("C:/Users/foo")

    expect(names).toContain(persistTesting.workspaceStorageName("C:\\Users\\foo"))
    expect(names).toContain(persistTesting.workspaceStorageName("c:/Users/foo/"))
  })

  test("legacy scoped keys cover equivalent directory aliases", () => {
    expect(persistTesting.legacyScoped("C:/Users/foo", "s1", "file", "v1")).toEqual(
      expect.arrayContaining([
        "C:/Users/foo/file/s1.v1",
        "C:\\Users\\foo/file/s1.v1",
        "c:/users/foo/file/s1.v1",
      ]),
    )
  })

  test("removePersisted clears current and legacy aliases across lookup stores", () => {
    const dir = "C:/Users/foo"
    const legacy = persistTesting.legacyScoped(dir, "s1", "terminal", "v1")
    const target = {
      ...Persist.workspace(dir, "terminal"),
      legacy,
    }

    const current = persistTesting.workspaceStorage(dir)
    const extra = persistTesting.workspaceLegacyStorage(dir)[0]!
    const direct = persistTesting.localStorageDirect()

    persistTesting.localStorageWithPrefix(current).setItem("workspace:terminal", '{"current":1}')
    persistTesting.localStorageWithPrefix(extra).setItem(legacy[0]!, '{"extra":1}')
    direct.setItem("workspace:terminal", '{"legacy-current":1}')
    direct.setItem(legacy[1]!, '{"legacy":1}')

    removePersisted(target)

    expect(persistTesting.localStorageWithPrefix(current).getItem("workspace:terminal")).toBeNull()
    expect(persistTesting.localStorageWithPrefix(extra).getItem(legacy[0]!)).toBeNull()
    expect(direct.getItem("workspace:terminal")).toBeNull()
    expect(direct.getItem(legacy[1]!)).toBeNull()
  })
})
