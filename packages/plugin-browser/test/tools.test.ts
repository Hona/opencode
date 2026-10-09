import { expect, test } from "bun:test"
import { mkdtemp, readdir, rm, symlink } from "node:fs/promises"
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
  for (const path of [
    "/tmp/page.html",
    "./page.html",
    "../page.html",
    "C:\\Users\\me\\page.html",
    "D:/page.html",
    "file:///tmp/a.html",
  ])
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

// The plugin cannot ask for edit permission, so a page's download must not land on a real file such as ~/.bashrc.
test("a capture saved to a named path stays in the workspace and replaces only files it saved", async () => {
  const directory = await mkdtemp(join(tmpdir(), "browser-save-"))
  const outside = await mkdtemp(join(tmpdir(), "browser-outside-"))
  try {
    await Bun.write(join(directory, "README.md"), "keep")
    await symlink(outside, join(directory, "link"), "junction")
    const written = new Set<string>()
    const save = (input: string, byte: number) =>
      Effect.runPromise(
        BrowserFiles.destination(input, directory, written).pipe(
          Effect.flatMap((path) =>
            BrowserFiles.save(
              [
                {
                  id: Browser.FileID.make(`file_${crypto.randomUUID()}`),
                  name: "s.png",
                  mime: "image/png",
                  data: new Uint8Array([byte]),
                },
              ],
              { path, written },
            ),
          ),
        ),
      )

    expect((await save("pr/after.png", 1))[0]?.path).toBe(join(directory, "pr", "after.png"))
    await save("pr/after.png", 2)
    expect(new Uint8Array(await Bun.file(join(directory, "pr", "after.png")).arrayBuffer())).toEqual(
      new Uint8Array([2]),
    )

    const refused = await Promise.all(
      ["README.md", "../escape.png", join(outside, "a.png"), "link/a.png"].map((input) =>
        save(input, 3).then(
          () => "saved",
          (error: Error) => error.message,
        ),
      ),
    )
    expect(refused[0]).toContain("a file already exists there")
    for (const message of refused.slice(1)) expect(message).toContain("the path is outside the workspace")
    expect(await Bun.file(join(directory, "README.md")).text()).toBe("keep")
    expect(await readdir(outside)).toEqual([])
  } finally {
    await rm(directory, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

// Agents built throwaway servers (and one committed its fixtures) because tabs could not open local HTML. Served pages
// share one origin, so a page's scripts can read whatever is served.
test("a local file is served with its folder, without dotfiles, parents or symlinks out, until the plugin stops", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "browser-serve-"))
  const outside = await mkdtemp(join(tmpdir(), "browser-outside-"))
  try {
    await Bun.write(join(workspace, "site", "index.html"), '<link rel="stylesheet" href="assets/a.css">')
    await Bun.write(join(workspace, "site", "assets", "a.css"), "body{}")
    await Bun.write(join(workspace, "site", ".env"), "TOKEN=secret")
    await Bun.write(join(workspace, "site", ".git", "config"), "[remote]")
    await Bun.write(join(workspace, "secret.txt"), "no")
    await Bun.write(join(outside, "secret.txt"), "no")
    await Bun.write(join(outside, "report.html"), "<p>report</p>")
    // Package managers link node_modules entries to folders elsewhere.
    await symlink(outside, join(workspace, "site", "node_modules"), "junction")
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
              [
                ".env",
                ".git/config",
                "..%2Fsecret.txt",
                "assets%2F..%2F..%2Fsecret.txt",
                "node_modules/secret.txt",
                "%E0%A4%A",
              ].map((path) => fetch(new URL(path, page).href).then((response) => response.status)),
            ),
          )
          expect(statuses).toEqual([404, 404, 404, 404, 404, 404])

          // Outside the workspace a page brings nothing but itself.
          const report = yield* serve.url(join(outside, "report.html"))
          expect(yield* Effect.promise(() => text(report))).toBe("<p>report</p>")
          expect(
            yield* Effect.promise(() => fetch(new URL("secret.txt", report).href).then((response) => response.status)),
          ).toBe(404)

          const refused = yield* Effect.forEach(
            ["nope.html", "site/.git/config", join(outside, "secret.txt")],
            (path) => Effect.flip(serve.url(path)).pipe(Effect.map((error) => error.message)),
          )
          expect(refused[0]).toContain("check that the file exists on the server")
          expect(refused[1]).toContain("only an HTML or SVG page is served")
          expect(refused[2]).toContain("only an HTML or SVG page is served")
          return page
        }),
      ),
    )
    // The plugin's scope closing stops the server.
    expect(
      await fetch(page).then(
        () => "open",
        () => "closed",
      ),
    ).toBe("closed")
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
