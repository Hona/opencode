import { afterEach, describe, expect, test } from "bun:test"
import { evictContentLru, resetFileContentLru, touchFileContent } from "./content-cache"

describe("file content eviction", () => {
  afterEach(() => {
    resetFileContentLru()
  })

  test("evicts by entry cap using LRU order", () => {
    Array.from({ length: 41 }, (_, n) => touchFileContent(`f-${n}`, 1))

    const evicted: string[] = []
    evictContentLru(undefined, (path) => evicted.push(path))
    evictContentLru(undefined, (path) => evicted.push(path))

    expect(evicted).toEqual(["f-0"])
  })

  test("evicts by byte cap while preserving protected entries", () => {
    const chunk = 8 * 1024 * 1024
    touchFileContent("a", chunk)
    touchFileContent("b", chunk)
    touchFileContent("c", chunk)

    const evicted: string[] = []
    evictContentLru(new Set(["a"]), (path) => evicted.push(path))
    evictContentLru(new Set(["a"]), (path) => evicted.push(path))

    expect(evicted).toEqual(["b"])
  })
})
