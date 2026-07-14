import { expect, test, type Page, type Route } from "@playwright/test"
import { expectAppVisible } from "../utils/waits"

const draftID = "draft_new_session_project_picker"
const serverA = "http://127.0.0.1:4096"
const serverB = "http://127.0.0.1:4097"
const directoryA = "C:/server-a"
const directoryB = "/home/server-b"

test("opens the multi-server project picker", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await mockServers(page)
  await page.addInitScript(() => {
    // Solid clones static JSX from a body-less template document before the browser adopts it.
    const clones = new WeakSet<Element>()
    const cloneNode = Node.prototype.cloneNode
    Node.prototype.cloneNode = function (deep) {
      const clone = cloneNode.call(this, deep)
      if (clone instanceof Element && !clone.ownerDocument.body) clones.add(clone)
      return clone
    }
    Object.assign(window, { __isInertTemplateClone: (element: Element) => clones.has(element) })
  })
  await page.addInitScript(
    ({ directoryA, directoryB, draftID, serverA, serverB }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          list: [serverB],
          projects: {
            local: [{ worktree: directoryA, expanded: true }],
            [serverB]: [{ worktree: directoryB, expanded: true }],
          },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "draft", draftID, server: serverA, directory: directoryA }]),
      )
    },
    { directoryA, directoryB, draftID, serverA, serverB },
  )

  await page.goto(`/new-session?draftId=${draftID}`)
  await expectAppVisible(page.locator('[data-component="prompt-input"]'))

  const trigger = page.locator('[data-action="prompt-project"]')
  await expect(trigger).toBeVisible()
  expect(
    await trigger.evaluate((element) =>
      (window as unknown as { __isInertTemplateClone: (element: Element) => boolean }).__isInertTemplateClone(element),
    ),
  ).toBe(false)
  await trigger.click()

  await expect(page.locator("#prompt-project-menu")).toBeVisible()
  expect(errors).toEqual([])
})

async function mockServers(page: Page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverA && url.origin !== serverB) return route.fallback()
    const directory = url.origin === serverA ? directoryA : directoryB
    const project = {
      id: `project-${url.origin === serverA ? "a" : "b"}`,
      worktree: directory,
      vcs: "git",
      name: url.origin === serverA ? "Server A" : "Server B",
      time: { created: 1, updated: 1 },
      sandboxes: [],
    }
    if (url.pathname === "/global/event" || url.pathname === "/event") return sse(route)
    if (url.pathname === "/global/health") return json(route, { healthy: true })
    if (url.pathname === "/project") return json(route, [project])
    if (url.pathname === "/project/current") return json(route, project)
    if (url.pathname === "/path")
      return json(route, { state: directory, config: directory, worktree: directory, directory, home: directory })
    if (url.pathname === "/provider") return json(route, { all: [], connected: [], default: {} })
    if (url.pathname === "/agent") return json(route, [{ name: "build", mode: "primary" }])
    if (url.pathname === "/api/session") return json(route, { data: [], cursor: {} })
    if (url.pathname === "/api/reference")
      return json(route, { location: { directory, project: { id: project.id, directory } }, data: [] })
    if (url.pathname === "/experimental/capabilities") return json(route, { backgroundSubagents: false })
    if (
      [
        "/skill",
        "/command",
        "/lsp",
        "/formatter",
        "/permission",
        "/question",
        "/vcs/diff",
        "/pty/shells",
        "/session",
      ].includes(url.pathname)
    )
      return json(route, [])
    if (["/global/config", "/config", "/provider/auth", "/mcp", "/session/status"].includes(url.pathname))
      return json(route, {})
    if (url.pathname === "/vcs") return json(route, { branch: "main", default_branch: "main" })
    return json(route, {})
  })
}

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  })
}

function sse(route: Route) {
  return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": ok\n\n" })
}
