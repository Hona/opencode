import type { FileContent } from "@opencode-ai/sdk/v2"

const MAX_FILE_CONTENT_ENTRIES = 40
const MAX_FILE_CONTENT_BYTES = 20 * 1024 * 1024

export function approxBytes(content: FileContent) {
  const patchBytes =
    content.patch?.hunks.reduce((sum, hunk) => {
      return sum + hunk.lines.reduce((lineSum, line) => lineSum + line.length, 0)
    }, 0) ?? 0

  return (content.content.length + (content.diff?.length ?? 0) + patchBytes) * 2
}

export function createFileContentCache() {
  const lru = new Map<string, number>()
  let total = 0

  const set = (path: string, nextBytes: number) => {
    const prev = lru.get(path)
    if (prev !== undefined) total -= prev
    lru.delete(path)
    lru.set(path, nextBytes)
    total += nextBytes
  }

  const touch = (path: string, bytes?: number) => {
    const prev = lru.get(path)
    if (prev === undefined && bytes === undefined) return
    set(path, bytes ?? prev ?? 0)
  }

  const remove = (path: string) => {
    const prev = lru.get(path)
    if (prev === undefined) return
    lru.delete(path)
    total -= prev
  }

  const reset = () => {
    lru.clear()
    total = 0
  }

  const evict = (keep: Set<string> | undefined, drop: (path: string) => void) => {
    const kept = keep ?? new Set<string>()

    while (lru.size > MAX_FILE_CONTENT_ENTRIES || total > MAX_FILE_CONTENT_BYTES) {
      const path = lru.keys().next().value
      if (!path) return

      if (kept.has(path)) {
        touch(path)
        if (lru.size <= kept.size) return
        continue
      }

      remove(path)
      drop(path)
    }
  }

  return {
    evict,
    reset,
    set,
    remove,
    touch,
    total: () => total,
    count: () => lru.size,
    has: (path: string) => lru.has(path),
  }
}

const cache = createFileContentCache()

export function evictContentLru(keep: Set<string> | undefined, evict: (path: string) => void) {
  cache.evict(keep, evict)
}

export function resetFileContentLru() {
  cache.reset()
}

export function setFileContentBytes(path: string, bytes: number) {
  cache.set(path, bytes)
}

export function removeFileContentBytes(path: string) {
  cache.remove(path)
}

export function touchFileContent(path: string, bytes?: number) {
  cache.touch(path, bytes)
}

export function getFileContentBytesTotal() {
  return cache.total()
}

export function getFileContentEntryCount() {
  return cache.count()
}

export function hasFileContent(path: string) {
  return cache.has(path)
}
