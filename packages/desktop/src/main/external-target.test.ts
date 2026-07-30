import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { resolveExternalTarget } from "./external-target"

describe("external targets", () => {
  test("opens web URLs externally", () => {
    expect(resolveExternalTarget("https://example.com/a?b=c")).toEqual({
      type: "url",
      value: "https://example.com/a?b=c",
    })
    expect(resolveExternalTarget("http://example.com")).toEqual({ type: "url", value: "http://example.com/" })
  })

  test("opens local file URLs as paths", () => {
    const url = pathToFileURL(resolve("example.html"))
    expect(resolveExternalTarget(url.href)).toEqual({ type: "path", value: fileURLToPath(url) })
  })

  test("rejects remote files and unsupported protocols", () => {
    expect(resolveExternalTarget("file://example.com/share/index.html")).toBeUndefined()
    expect(resolveExternalTarget("javascript:alert(1)")).toBeUndefined()
    expect(resolveExternalTarget("data:text/html,hello")).toBeUndefined()
    expect(resolveExternalTarget("not a url")).toBeUndefined()
  })
})
