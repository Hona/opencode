import { Platform, usePlatform } from "@/context/platform"
import { workspacePathKey } from "@/context/file/path"
import { makePersisted, type AsyncStorage, type SyncStorage } from "@solid-primitives/storage"
import { checksum } from "@opencode-ai/util/encode"
import { createResource, type Accessor } from "solid-js"
import type { SetStoreFunction, Store } from "solid-js/store"

type InitType = Promise<string> | string | null
type PersistedWithReady<T> = [
  Store<T>,
  SetStoreFunction<T>,
  InitType,
  Accessor<boolean> & { promise: undefined | Promise<any> },
]

type PersistTarget = {
  storage?: string
  key: string
  legacy?: string[]
  legacyStorage?: string[]
  migrate?: (value: unknown) => unknown
}

const LEGACY_STORAGE = "default.dat"
const GLOBAL_STORAGE = "opencode.global.dat"
const LOCAL_PREFIX = "opencode."
const fallback = new Map<string, boolean>()

const CACHE_MAX_ENTRIES = 500
const CACHE_MAX_BYTES = 8 * 1024 * 1024

type CacheEntry = { value: string; bytes: number }
const cache = new Map<string, CacheEntry>()
const cacheTotal = { bytes: 0 }

type PersistStore = SyncStorage | AsyncStorage
type PersistStores = {
  current: PersistStore
  legacy?: PersistStore
  extra: PersistStore[]
}

function cacheDelete(key: string) {
  const entry = cache.get(key)
  if (!entry) return
  cacheTotal.bytes -= entry.bytes
  cache.delete(key)
}

function cachePrune() {
  for (;;) {
    if (cache.size <= CACHE_MAX_ENTRIES && cacheTotal.bytes <= CACHE_MAX_BYTES) return
    const oldest = cache.keys().next().value as string | undefined
    if (!oldest) return
    cacheDelete(oldest)
  }
}

function cacheSet(key: string, value: string) {
  const bytes = value.length * 2
  if (bytes > CACHE_MAX_BYTES) {
    cacheDelete(key)
    return
  }

  const entry = cache.get(key)
  if (entry) cacheTotal.bytes -= entry.bytes
  cache.delete(key)
  cache.set(key, { value, bytes })
  cacheTotal.bytes += bytes
  cachePrune()
}

function cacheGet(key: string) {
  const entry = cache.get(key)
  if (!entry) return
  cache.delete(key)
  cache.set(key, entry)
  return entry.value
}

function fallbackDisabled(scope: string) {
  return fallback.get(scope) === true
}

function fallbackSet(scope: string) {
  fallback.set(scope, true)
}

function quota(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "QuotaExceededError") return true
    if (error.name === "NS_ERROR_DOM_QUOTA_REACHED") return true
    if (error.name === "QUOTA_EXCEEDED_ERR") return true
    if (error.code === 22 || error.code === 1014) return true
    return false
  }

  if (!error || typeof error !== "object") return false
  const name = (error as { name?: string }).name
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") return true
  if (name && /quota/i.test(name)) return true

  const code = (error as { code?: number }).code
  if (code === 22 || code === 1014) return true

  const message = (error as { message?: string }).message
  if (typeof message !== "string") return false
  if (/quota/i.test(message)) return true
  return false
}

type Evict = { key: string; size: number }

function evict(storage: Storage, keep: string, value: string) {
  const total = storage.length
  const indexes = Array.from({ length: total }, (_, index) => index)
  const items: Evict[] = []

  for (const index of indexes) {
    const name = storage.key(index)
    if (!name) continue
    if (!name.startsWith(LOCAL_PREFIX)) continue
    if (name === keep) continue
    const stored = storage.getItem(name)
    items.push({ key: name, size: stored?.length ?? 0 })
  }

  items.sort((a, b) => b.size - a.size)

  for (const item of items) {
    storage.removeItem(item.key)
    cacheDelete(item.key)

    try {
      storage.setItem(keep, value)
      cacheSet(keep, value)
      return true
    } catch (error) {
      if (!quota(error)) throw error
    }
  }

  return false
}

function write(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value)
    cacheSet(key, value)
    return true
  } catch (error) {
    if (!quota(error)) throw error
  }

  try {
    storage.removeItem(key)
    cacheDelete(key)
    storage.setItem(key, value)
    cacheSet(key, value)
    return true
  } catch (error) {
    if (!quota(error)) throw error
  }

  const ok = evict(storage, key, value)
  return ok
}

function snapshot(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function merge(defaults: unknown, value: unknown): unknown {
  if (value === undefined) return defaults
  if (value === null) return value

  if (Array.isArray(defaults)) {
    if (Array.isArray(value)) return value
    return defaults
  }

  if (isRecord(defaults)) {
    if (!isRecord(value)) return defaults

    const result: Record<string, unknown> = { ...defaults }
    for (const key of Object.keys(value)) {
      if (key in defaults) {
        result[key] = merge((defaults as Record<string, unknown>)[key], (value as Record<string, unknown>)[key])
      } else {
        result[key] = (value as Record<string, unknown>)[key]
      }
    }
    return result
  }

  return value
}

function parse(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function normalize(defaults: unknown, raw: string, migrate?: (value: unknown) => unknown) {
  const parsed = parse(raw)
  if (parsed === undefined) return
  const migrated = migrate ? migrate(parsed) : parsed
  const merged = merge(defaults, migrated)
  return JSON.stringify(merged)
}

function workspaceDirectory(dir: string) {
  return workspacePathKey(dir)
}

function trimDir(dir: string) {
  if (!dir) return dir
  if (/^[A-Za-z]:[\\/]?$/.test(dir)) return dir.slice(0, 2)
  const trimmed = dir.replace(/[\\/]+$/, "")
  return trimmed || dir
}

function windowsPath(dir: string) {
  return /^[A-Za-z]:/.test(dir) || /^[\\/]{2}/.test(dir) || dir.includes("\\")
}

function driveLetters(dir: string) {
  if (!/^[A-Za-z]:/.test(dir)) return [dir]
  return [dir[0].toLowerCase() + dir.slice(1), dir[0].toUpperCase() + dir.slice(1)]
}

function pathForms(dir: string) {
  const base = trimDir(dir)
  if (!base) return []
  if (!windowsPath(base)) return [base]
  return [base, base.replace(/\\/g, "/"), base.replace(/\//g, "\\")]
}

function withTrailing(dir: string) {
  if (!dir) return []
  if (!windowsPath(dir)) return dir === "/" ? [dir] : [dir, `${dir}/`]
  if (/^[A-Za-z]:$/.test(dir)) return [`${dir}/`, `${dir}\\`]
  if (/^[\\/]{2}[^\\/]+[\\/][^\\/]+$/.test(dir)) return [dir, `${dir}/`, `${dir}\\`]
  const tail = dir.includes("\\") ? "\\" : "/"
  return [dir, `${dir}${tail}`]
}

function workspaceDirectories(dir: string) {
  const seen = new Set<string>()

  const add = (value: string) => {
    if (!value) return
    seen.add(value)
  }

  for (const value of [dir, workspaceDirectory(dir)]) {
    for (const form of pathForms(value)) {
      for (const letter of driveLetters(form)) {
        for (const item of withTrailing(letter)) {
          add(item)
        }
      }
    }
  }

  return Array.from(seen)
}

function workspaceStorageName(dir: string) {
  const head = (dir.slice(0, 12) || "workspace").replace(/[^a-zA-Z0-9._-]/g, "-")
  const sum = checksum(dir) ?? "0"
  return `opencode.workspace.${head}.${sum}.dat`
}

function workspaceStorage(dir: string) {
  return workspaceStorageName(workspaceDirectory(dir))
}

function workspaceLegacyStorage(dir: string) {
  const current = workspaceStorage(dir)
  return workspaceDirectories(dir)
    .map(workspaceStorageName)
    .filter((item, index, list) => item !== current && list.indexOf(item) === index)
}

function legacyScoped(dir: string, session: string | undefined, key: string, version: string) {
  return workspaceDirectories(dir)
    .map((root) => `${root}/${key}${session ? "/" + session : ""}.${version}`)
    .filter((item, index, list) => list.indexOf(item) === index)
}

function localStorageWithPrefix(prefix: string): SyncStorage {
  const base = `${prefix}:`
  const scope = `prefix:${prefix}`
  const item = (key: string) => base + key
  return {
    getItem: (key) => {
      const name = item(key)
      const cached = cacheGet(name)
      if (fallbackDisabled(scope)) return cached ?? null

      const stored = (() => {
        try {
          return localStorage.getItem(name)
        } catch {
          fallbackSet(scope)
          return null
        }
      })()
      if (stored === null) return cached ?? null
      cacheSet(name, stored)
      return stored
    },
    setItem: (key, value) => {
      const name = item(key)
      if (fallbackDisabled(scope)) return
      try {
        if (write(localStorage, name, value)) return
      } catch {
        fallbackSet(scope)
        return
      }
      fallbackSet(scope)
    },
    removeItem: (key) => {
      const name = item(key)
      cacheDelete(name)
      if (fallbackDisabled(scope)) return
      try {
        localStorage.removeItem(name)
      } catch {
        fallbackSet(scope)
      }
    },
  }
}

function localStorageDirect(): SyncStorage {
  const scope = "direct"
  return {
    getItem: (key) => {
      const cached = cacheGet(key)
      if (fallbackDisabled(scope)) return cached ?? null

      const stored = (() => {
        try {
          return localStorage.getItem(key)
        } catch {
          fallbackSet(scope)
          return null
        }
      })()
      if (stored === null) return cached ?? null
      cacheSet(key, stored)
      return stored
    },
    setItem: (key, value) => {
      if (fallbackDisabled(scope)) return
      try {
        if (write(localStorage, key, value)) return
      } catch {
        fallbackSet(scope)
        return
      }
      fallbackSet(scope)
    },
    removeItem: (key) => {
      cacheDelete(key)
      if (fallbackDisabled(scope)) return
      try {
        localStorage.removeItem(key)
      } catch {
        fallbackSet(scope)
      }
    },
  }
}

function stores(config: PersistTarget, platform?: Platform): PersistStores {
  const isDesktop = platform?.platform === "desktop" && !!platform.storage

  return {
    current: (() => {
      if (isDesktop) return platform.storage!(config.storage)
      if (!config.storage) return localStorageDirect()
      return localStorageWithPrefix(config.storage)
    })(),
    legacy: (() => {
      if (!isDesktop) return localStorageDirect()
      if (!config.storage) return platform.storage!()
      return platform.storage!(LEGACY_STORAGE)
    })(),
    extra: (() => {
      if (!config.legacyStorage?.length) return []
      if (!isDesktop) return config.legacyStorage.map((storage) => localStorageWithPrefix(storage))
      return config.legacyStorage.flatMap((storage) => {
        const item = platform.storage!(storage)
        return item ? [item] : []
      })
    })(),
  }
}

export const PersistTesting = {
  legacyScoped,
  localStorageDirect,
  localStorageWithPrefix,
  normalize,
  workspaceDirectory,
  workspaceDirectories,
  workspaceStorage,
  workspaceStorageName,
  workspaceLegacyStorage,
}

export const Persist = {
  legacyScoped,
  global(key: string, legacy?: string[]): PersistTarget {
    return { storage: GLOBAL_STORAGE, key, legacy }
  },
  workspace(dir: string, key: string, legacy?: string[]): PersistTarget {
    return {
      storage: workspaceStorage(dir),
      key: `workspace:${key}`,
      legacy,
      legacyStorage: workspaceLegacyStorage(dir),
    }
  },
  session(dir: string, session: string, key: string, legacy?: string[]): PersistTarget {
    return {
      storage: workspaceStorage(dir),
      key: `session:${session}:${key}`,
      legacy,
      legacyStorage: workspaceLegacyStorage(dir),
    }
  },
  scoped(dir: string, session: string | undefined, key: string, legacy?: string[]): PersistTarget {
    if (session) return Persist.session(dir, session, key, legacy)
    return Persist.workspace(dir, key, legacy)
  },
}

export function removePersisted(target: PersistTarget, platform?: Platform) {
  const keys = [target.key, ...(target.legacy ?? [])]
  const seen = new Set<PersistStore>()
  const all = stores(target, platform)

  for (const store of [all.current, all.legacy, ...all.extra]) {
    if (!store || seen.has(store)) continue
    seen.add(store)
    for (const key of keys) {
      store.removeItem(key)
    }
  }
}

export function persisted<T>(
  target: string | PersistTarget,
  store: [Store<T>, SetStoreFunction<T>],
): PersistedWithReady<T> {
  const platform = usePlatform()
  const config: PersistTarget = typeof target === "string" ? { key: target } : target

  const defaults = snapshot(store[0])
  const legacy = config.legacy ?? []

  const isDesktop = platform.platform === "desktop" && !!platform.storage
  const all = stores(config, platform)

  const storage = (() => {
    if (!isDesktop) {
      const current = all.current as SyncStorage
      const legacyStore = all.legacy as SyncStorage
      const extra = all.extra as SyncStorage[]

      const api: SyncStorage = {
        getItem: (key) => {
          const sources = [{ storage: current, keys: [key, ...legacy] }]
          if (legacyStore) sources.push({ storage: legacyStore, keys: [key, ...legacy] })
          for (const storage of extra) {
            sources.push({ storage, keys: [key, ...legacy] })
          }

          for (const source of sources) {
            for (const name of source.keys) {
              const raw = source.storage.getItem(name)
              if (raw === null) continue

              const next = normalize(defaults, raw, config.migrate)
              if (next === undefined) {
                source.storage.removeItem(name)
                continue
              }

              if (source.storage !== current || name !== key) {
                current.setItem(key, next)
                source.storage.removeItem(name)
                return next
              }

              if (raw !== next) current.setItem(key, next)
              return next
            }
          }

          return null
        },
        setItem: (key, value) => {
          current.setItem(key, value)
        },
        removeItem: (key) => {
          current.removeItem(key)
        },
      }

      return api
    }

    const current = all.current as AsyncStorage
    const legacyStore = all.legacy as AsyncStorage | undefined
    const extra = all.extra as AsyncStorage[]

    const api: AsyncStorage = {
      getItem: async (key) => {
        const sources = [{ storage: current, keys: [key, ...legacy] }]
        if (legacyStore) sources.push({ storage: legacyStore, keys: [key, ...legacy] })
        for (const storage of extra) {
          sources.push({ storage, keys: [key, ...legacy] })
        }

        for (const source of sources) {
          for (const name of source.keys) {
            const raw = await source.storage.getItem(name)
            if (raw === null) continue

            const next = normalize(defaults, raw, config.migrate)
            if (next === undefined) {
              await source.storage.removeItem(name).catch(() => undefined)
              continue
            }

            if (source.storage !== current || name !== key) {
              await current.setItem(key, next)
              await source.storage.removeItem(name).catch(() => undefined)
              return next
            }

            if (raw !== next) await current.setItem(key, next)
            return next
          }
        }

        return null
      },
      setItem: async (key, value) => {
        await current.setItem(key, value)
      },
      removeItem: async (key) => {
        await current.removeItem(key)
      },
    }

    return api
  })()

  const [state, setState, init] = makePersisted(store, { name: config.key, storage })

  const isAsync = init instanceof Promise
  const [ready] = createResource(
    () => init,
    async (initValue) => {
      if (initValue instanceof Promise) await initValue
      return true
    },
    { initialValue: !isAsync },
  )

  return [
    state,
    setState,
    init,
    Object.assign(() => ready() === true, {
      promise: init instanceof Promise ? init : undefined,
    }),
  ]
}
