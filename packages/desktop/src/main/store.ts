import Store from "electron-store"
import electron from "electron"
import { rmSync } from "node:fs"
import { join } from "node:path"

import { SETTINGS_STORE } from "./store-keys"
import { deleteStoreFileIfEmpty } from "./store-cleanup"

const DELETED = Symbol("DELETED")

export class BufferedStore {
  private pending = new Map<string, unknown>()
  private cleared = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private target: {
      get(key: string): unknown
      set(key: string, val: unknown): void
      delete(key: string): void
      clear(): void
      has(key: string): boolean
      store: Record<string, unknown>
    },
    private delay = 150,
  ) {}

  get store(): Record<string, unknown> {
    const base = this.cleared ? {} : { ...this.target.store }
    for (const [key, value] of this.pending) {
      if (value === DELETED) {
        delete base[key]
      } else {
        base[key] = value
      }
    }
    return base
  }

  has(key: string): boolean {
    if (this.pending.has(key)) {
      return this.pending.get(key) !== DELETED
    }
    if (this.cleared) return false
    return this.target.has(key)
  }

  get(key: string) {
    if (this.pending.has(key)) {
      const val = this.pending.get(key)
      return val === DELETED ? undefined : val
    }
    if (this.cleared) return undefined
    return this.target.get(key)
  }

  set(key: string, value: unknown) {
    this.pending.set(key, value)
    this.scheduleFlush()
  }

  delete(key: string) {
    this.pending.set(key, DELETED)
    this.scheduleFlush()
  }

  clear() {
    this.cleared = true
    this.pending.clear()
    this.scheduleFlush()
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.cleared) {
      this.target.clear()
      this.cleared = false
    }
    for (const [key, value] of this.pending) {
      if (value === DELETED) {
        this.target.delete(key)
      } else {
        this.target.set(key, value)
      }
    }
    this.pending.clear()
  }

  private scheduleFlush() {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), this.delay)
  }
}

const cache = new Map<string, BufferedStore>()

export function getStore(name = SETTINGS_STORE): BufferedStore {
  const cached = cache.get(name)
  if (cached) return cached
  const underlying = new Store({
    name,
    cwd: electron.app.getPath("userData"),
    fileExtension: "",
    accessPropertiesByDotNotation: false,
  })
  const next = new BufferedStore(underlying)
  cache.set(name, next)
  return next
}

export function flushAllStores() {
  for (const store of cache.values()) {
    store.flush()
  }
}

export async function removeStoreFileIfEmpty(name: string) {
  cache.get(name)?.flush()
  if (await deleteStoreFileIfEmpty(electron.app.getPath("userData"), name)) cache.delete(name)
}

export function removeStoreFile(name: string) {
  cache.get(name)?.flush()
  rmSync(join(electron.app.getPath("userData"), name), { force: true })
  cache.delete(name)
}
