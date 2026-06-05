type ScopedCacheOptions<T, K> = {
  maxEntries?: number
  ttlMs?: number
  dispose?: (value: T, key: K) => void
  now?: () => number
}

type Entry<T> = {
  value: T
  touchedAt: number
}

export function createScopedCache<T, K = string, Args extends readonly unknown[] = []>(
  createValue: (key: K, ...args: Args) => T,
  options: ScopedCacheOptions<T, K> = {},
) {
  const store = new Map<K, Entry<T>>()
  const now = options.now ?? Date.now

  const dispose = (key: K, entry: Entry<T>) => {
    options.dispose?.(entry.value, key)
  }

  const expired = (entry: Entry<T>) => {
    if (options.ttlMs === undefined) return false
    return now() - entry.touchedAt >= options.ttlMs
  }

  const sweep = () => {
    if (options.ttlMs === undefined) return
    for (const [key, entry] of store) {
      if (!expired(entry)) continue
      store.delete(key)
      dispose(key, entry)
    }
  }

  const touch = (key: K, entry: Entry<T>) => {
    entry.touchedAt = now()
    store.delete(key)
    store.set(key, entry)
  }

  const prune = () => {
    if (options.maxEntries === undefined) return
    while (store.size > options.maxEntries) {
      const first = store.keys().next()
      if (first.done) return
      const key = first.value
      const entry = store.get(key)
      store.delete(key)
      if (!entry) continue
      dispose(key, entry)
    }
  }

  const remove = (key: K) => {
    const entry = store.get(key)
    if (!entry) return
    store.delete(key)
    dispose(key, entry)
    return entry.value
  }

  const peek = (key: K) => {
    sweep()
    const entry = store.get(key)
    if (!entry) return
    if (!expired(entry)) return entry.value
    store.delete(key)
    dispose(key, entry)
  }

  const get = (key: K, ...args: Args) => {
    sweep()
    const entry = store.get(key)
    if (entry && !expired(entry)) {
      touch(key, entry)
      return entry.value
    }
    if (entry) {
      store.delete(key)
      dispose(key, entry)
    }

    const created = {
      value: createValue(key, ...args),
      touchedAt: now(),
    }
    store.set(key, created)
    prune()
    return created.value
  }

  const clear = () => {
    for (const [key, entry] of store) {
      dispose(key, entry)
    }
    store.clear()
  }

  return {
    get,
    peek,
    delete: remove,
    clear,
  }
}
