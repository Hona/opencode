import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { Effect } from "effect"
import { Browser } from "../src/rpc.js"
import { BrowserFiles } from "../src/files.js"
import { BrowserServe } from "../src/serve.js"
import { BrowserTools } from "../src/tools.js"

const tabID = Browser.TabID.make(`tab_${crypto.randomUUID()}`)
const navigate = (url: string) => BrowserTools.normalizeAction({ type: "navigate", tabID, url })

test("URL normalization rejects filesystem paths and file URLs, and points at path instead", () => {
  for (const path of ["/tmp/page.html", "./page.html", "../page.html", "C:\\Users\\me\\page.html", "D:/page.html", "file:///tmp/a.html"])
    expect(() => navigate(path)).toThrow("pass path instead of url")
  expect(navigate("example.com/docs")).toEqual({ type: "navigate", tabID, url: "https://example.com/docs" })
  expect(navigate("localhost:8000")).toEqual({ type: "navigate", tabID, url: "http://localhost:8000/" })
  expect(BrowserTools.normalizeAction({ type: "tabs.open" })).toEqual({ type: "tabs.open" })
  expect(BrowserTools.normalizeAction({ type: "tabs.open", url: " " })).toEqual({
    type: "tabs.open",
    url: "about:blank",
  })
})

test("navigate takes exactly one destination", () => {
  expect(() => BrowserTools.normalizeAction({ type: "navigate", tabID })).toThrow("exactly one of url, path")
  expect(() =>
    BrowserTools.normalizeAction({ type: "navigate", tabID, url: "https://example.com", history: "back" }),
  ).toThrow("exactly one of url, path")
  expect(BrowserTools.normalizeAction({ type: "navigate", tabID, history: "back" })).toEqual({
    type: "navigate",
    tabID,
    history: "back",
  })
  expect(() =>
    BrowserTools.normalizeAction({ type: "tabs.open", url: "https://example.com", path: "index.html" }),
  ).toThrow("url or path, not both")
})

// `timeout` was the name agents wrote most; an undeclared key would be dropped and the wait would run ten seconds.
test("wait takes timeout as timeoutMs", () => {
  expect(BrowserTools.normalizeAction({ type: "wait", tabID, text: "Done", timeout: 1_000 })).toEqual({
    type: "wait",
    tabID,
    text: "Done",
    timeoutMs: 1_000,
  })
  expect(BrowserTools.normalizeAction({ type: "wait", tabID, timeout: 1_000, timeoutMs: 2_000 })).toEqual({
    type: "wait",
    tabID,
    timeoutMs: 2_000,
  })
})

test("URL normalization fails fast when percent-encoding exceeds the command bound", () => {
  const input = `https://example.com/${"é".repeat(400)}`
  expect(input.length).toBeLessThan(2_048)
  expect(new URL(input).href.length).toBeGreaterThan(2_048)
  expect(() => navigate(input)).toThrow()
})

test("saved capture names never escape their directory or name a Windows device", async () => {
  const file = (name: string) => ({
    id: Browser.FileID.make(`file_${crypto.randomUUID()}`),
    name,
    mime: "text/plain",
    data: new TextEncoder().encode(name),
  })
  const saved = await Effect.runPromise(
    BrowserFiles.save([file(".."), file("."), file("CON.txt"), file("lpt1"), file("report.html")]),
  )
  try {
    expect(saved.map((entry) => basename(entry.path))).toEqual([
      "capture",
      "capture",
      "capture",
      "capture",
      "report.html",
    ])
    expect(saved.map((entry) => entry.name)).toEqual(["..", ".", "CON.txt", "lpt1", "report.html"])
    expect(await Bun.file(saved[0]!.path).text()).toBe("..")
  } finally {
    await rm(dirname(dirname(saved[0]!.path)), { recursive: true, force: true })
  }
})

test("a capture saved to a chosen path creates its folders", async () => {
  const directory = await mkdtemp(join(tmpdir(), "browser-save-"))
  try {
    const saved = await Effect.runPromise(
      BrowserFiles.save(
        [{ id: Browser.FileID.make(`file_${crypto.randomUUID()}`), name: "s.png", mime: "image/png", data: new Uint8Array([1, 2]) }],
        { path: "pr/after.png", directory },
      ),
    )
    expect(saved[0]?.path).toBe(join(directory, "pr", "after.png"))
    expect(new Uint8Array(await Bun.file(join(directory, "pr", "after.png")).arrayBuffer())).toEqual(new Uint8Array([1, 2]))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// Agents built throwaway servers (and one committed its fixtures) because tabs could not open local HTML. Served pages
// share one origin, so a page's scripts can read whatever is served.
test("a local file is served with its folder, without dotfiles or parents, until the plugin stops", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "browser-serve-"))
  try {
    await Bun.write(join(workspace, "site", "index.html"), '<link rel="stylesheet" href="assets/a.css">')
    await Bun.write(join(workspace, "site", "assets", "a.css"), "body{}")
    await Bun.write(join(workspace, "site", ".env"), "TOKEN=secret")
    await Bun.write(join(workspace, "site", ".git", "config"), "[remote]")
    await Bun.write(join(workspace, "secret.txt"), "no")
    const text = (url: string) => fetch(url).then((response) => response.text())

    const page = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const serve = yield* BrowserServe.make(workspace)
          const page = yield* serve.url("site/index.html")
          expect(page).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]{36}\/index\.html$/)
          expect(yield* Effect.promise(() => text(page))).toContain("a.css")
          expect(yield* Effect.promise(() => text(new URL("assets/a.css", page).href))).toBe("body{}")
          const statuses = yield* Effect.promise(() =>
            Promise.all(
              [".env", ".git/config", "..%2Fsecret.txt", "assets%2F..%2F..%2Fsecret.txt"].map((path) =>
                fetch(new URL(path, page).href).then((response) => response.status),
              ),
            ),
          )
          expect(statuses).toEqual([404, 404, 404, 404])

          const missing = yield* Effect.flip(serve.url("nope.html"))
          expect(missing.message).toContain("check that the file exists on the server")
          return page
        }),
      ),
    )
    // The plugin's scope closing stops the server.
    expect(await fetch(page).then(() => "open", () => "closed")).toBe("closed")
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
