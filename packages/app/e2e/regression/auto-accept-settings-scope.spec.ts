import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { serverAcceptKey } from "../../src/context/permission-auto-respond"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

test("v2 desktop settings auto-accept applies across the active server", async ({ page }) => {
  const permissionLists: string[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (request.method() !== "GET" || url.pathname !== "/permission") return
    const directory = url.searchParams.get("directory")
    if (directory) permissionLists.push(directory)
  })

  await mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
  })
  await page.addInitScript((directory) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] } }),
    )
  }, fixture.directory)

  await page.goto("/")
  await page.getByRole("button", { name: "Settings" }).click()
  await expect(autoAccept(page)).toBeEnabled()
  await page.locator('[data-action="settings-auto-accept-permissions"] [data-slot="switch-control"]').click()
  await expect(autoAccept(page)).toBeChecked()
  await expect.poll(() => permissionState(page)).toEqual({ autoAccept: { [serverAcceptKey("http://127.0.0.1:4096")]: true } })
  await expect.poll(() => permissionLists).toContain(fixture.directory)
  await page.keyboard.press("Escape")

  const first = fixture.sessions[0]
  const second = fixture.sessions[1]
  await page.goto(`/${base64Encode(fixture.directory)}/session/${first.id}`)
  await openSessionSettings(page, first.title)
  await expect(autoAccept(page)).toBeChecked()
  await page.keyboard.press("Escape")

  await page.goto(`/${base64Encode(fixture.directory)}/session/${second.id}`)
  await openSessionSettings(page, second.title)
  await expect(autoAccept(page)).toBeChecked()
})

test("server auto-accept waits for inherited session overrides", async ({ page }) => {
  const parent = { ...fixture.sessions[0], id: "ses_parent" }
  const child = { ...fixture.sessions[1], id: "ses_child", parentID: parent.id }
  const responses: unknown[] = []
  let permissionLists = 0
  page.on("request", (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname === "/permission") permissionLists++
  })
  await mockOpenCodeServer(page, {
    sessions: [parent, child],
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages: () => ({ items: [] }),
    permissions: [
      {
        id: "per_child",
        sessionID: child.id,
        permission: "bash",
        patterns: ["*"],
        metadata: {},
        always: [],
      },
    ],
    onPermissionRespond: (input) => responses.push(input),
  })
  await page.addInitScript((input) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({ projects: { local: [{ worktree: input.directory, expanded: true }] } }),
    )
    localStorage.setItem(
      "opencode.global.dat:permission",
      JSON.stringify({ autoAccept: { [`${base64Encode(input.directory)}/${input.parentID}`]: false } }),
    )
  }, { directory: fixture.directory, parentID: parent.id })

  await page.goto("/")
  await page.getByRole("button", { name: "Settings" }).click()
  await page.locator('[data-action="settings-auto-accept-permissions"] [data-slot="switch-control"]').click()
  await expect.poll(() => permissionLists).toBeGreaterThan(0)
  await page.waitForTimeout(500)
  expect(responses).toEqual([])
})

async function openSessionSettings(page: import("@playwright/test").Page, title: string) {
  await expect(page.getByRole("heading", { name: title })).toBeVisible()
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true })))
  await expect(autoAccept(page)).toBeVisible()
}

function autoAccept(page: import("@playwright/test").Page) {
  return page.locator('[data-action="settings-auto-accept-permissions"] input')
}

function permissionState(page: import("@playwright/test").Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("opencode.global.dat:permission") ?? "{}"))
}
