import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/util/encode"
import type { LocationNotFoundError } from "@opencode-ai/client/promise"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"

for (const endpoint of ["/api/location", "/api/agent"]) {
  for (const recover of [false, true]) {
    test(`keeps the composer when ${endpoint} ${recover ? "recovers on retry" : "fails"}`, async ({ page }) => {
      const directory = "/projects/working-tree"
      const sessionID = "ses_location_sync_failure"
      await mockOpenCodeServer(page, {
        directory: fixture.directory,
        project: fixture.project,
        provider: fixture.provider,
        sessions: [{ id: sessionID, projectID: fixture.project.id, directory, title: "Workspace sync" }],
        fileList: () => [],
        pageMessages: () => ({
          items: [{ id: "msg_saved", type: "user", text: "Keep working in this worktree", time: { created: 1 } }],
        }),
      })
      let requests = 0
      await page.route("**/api/**", (route) => {
        const url = new URL(route.request().url())
        if (url.pathname !== endpoint || url.searchParams.get("location[directory]") !== directory)
          return route.fallback()
        requests++
        if (recover && requests > 1) return route.fallback()
        return route.fulfill({ status: 500, body: "", headers: { "access-control-allow-origin": "*" } })
      })
      const failure = page.waitForResponse(
        (response) => new URL(response.url()).pathname === endpoint && response.status() === 500,
      )
      const recovered = recover
        ? page.waitForResponse((response) => {
            const url = new URL(response.url())
            return (
              url.pathname === endpoint && url.searchParams.get("location[directory]") === directory && response.ok()
            )
          })
        : undefined
      await page.goto(`/server/${base64Encode(fixture.serverKey)}/session/${sessionID}`)
      await failure
      await expect(page.getByText("Keep working in this worktree", { exact: true })).toBeVisible()
      const prompt = page.getByRole("textbox", { name: "Prompt", exact: true })
      await expect(prompt).toBeEditable()
      await prompt.fill("Continue after reconnecting")
      await expect(prompt).toHaveText("Continue after reconnecting")
      if (recovered) {
        await recovered
        await expect(prompt).toHaveText("Continue after reconnecting")
        expect(requests).toBe(2)
      }
      await expect(page.getByText("Session location unavailable", { exact: true })).toHaveCount(0)
      await expect(page.getByRole("button", { name: "Choose directory", exact: true })).toHaveCount(0)
      await page.screenshot({ path: test.info().outputPath("location-sync.png") })
    })
  }
}

test("checks current session placement before offering to recover a missing location", async ({ page }) => {
  const directory = "/projects/old-tree"
  const destination = "/projects/current-tree"
  const sessionID = "ses_location_moved_while_loading"
  const session = { id: sessionID, projectID: fixture.project.id, directory, title: "Moved session" }
  const refresh = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await mockOpenCodeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    provider: fixture.provider,
    sessions: [session],
    fileList: () => [],
    pageMessages: () => ({
      items: [{ id: "msg_saved", type: "user", text: "Follow the session move", time: { created: 1 } }],
    }),
  })
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === "/api/location" && url.searchParams.get("location[directory]") === directory) {
      session.directory = destination
      return route.fulfill({
        status: 404,
        json: {
          _tag: "LocationNotFoundError",
          directory,
          message: "Missing directory",
        } satisfies LocationNotFoundError,
        headers: { "access-control-allow-origin": "*" },
      })
    }
    if (url.pathname === `/api/session/${sessionID}` && session.directory === destination) {
      refresh.resolve()
      await release.promise
    }
    return route.fallback()
  })
  const resolved = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.pathname === "/api/location" && url.searchParams.get("location[directory]") === destination && response.ok()
    )
  })
  await page.goto(`/server/${base64Encode(fixture.serverKey)}/session/${sessionID}`)
  await refresh.promise
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true })
  await expect(prompt).toBeEditable()
  await prompt.fill("Keep this draft")
  await expect(page.getByText("Session location unavailable", { exact: true })).toHaveCount(0)
  release.resolve()
  await resolved
  await expect(prompt).toHaveText("Keep this draft")
  await expect(page.getByText("Follow the session move", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Choose directory", exact: true })).toHaveCount(0)
})

test("refreshes a session moved during disconnection without losing the draft", async ({ page }) => {
  const directory = "/projects/before-reconnect"
  const destination = "/projects/after-reconnect"
  const sessionID = "ses_location_reconnect"
  const session = { id: sessionID, projectID: fixture.project.id, directory, title: "Reconnected session" }
  const transport = await installSseTransport(page, { server: fixture.serverKey })
  await mockOpenCodeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    provider: fixture.provider,
    sessions: [session],
    fileList: () => [],
    pageMessages: () => ({
      items: [{ id: "msg_saved", type: "user", text: "Resume in the current worktree", time: { created: 1 } }],
    }),
  })
  await page.goto(`/server/${base64Encode(fixture.serverKey)}/session/${sessionID}`)
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true })
  await expect(prompt).toBeEditable()
  await prompt.fill("Draft before disconnect")
  const connection = await transport.waitForConnection()
  const resolved = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.pathname === "/api/location" && url.searchParams.get("location[directory]") === destination && response.ok()
    )
  })
  session.directory = destination
  await transport.close()
  await transport.waitForConnection({ after: connection.id })
  await resolved
  await expect(prompt).toHaveText("Draft before disconnect")
  await expect(page.getByText("Resume in the current worktree", { exact: true })).toBeVisible()
  await expect(page.getByText("Session location unavailable", { exact: true })).toHaveCount(0)
})

test("ignores an old missing-location response after reconnecting", async ({ page }) => {
  const directory = "/projects/reconnected-tree"
  const sessionID = "ses_location_stale_response"
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const transport = await installSseTransport(page, { server: fixture.serverKey })
  await mockOpenCodeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    provider: fixture.provider,
    sessions: [{ id: sessionID, projectID: fixture.project.id, directory }],
    fileList: () => [],
    pageMessages: () => ({ items: [] }),
  })
  let requests = 0
  await page.route("**/api/location?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("location[directory]") !== directory) return route.fallback()
    requests++
    if (requests > 1) return route.fallback()
    requested.resolve()
    await release.promise
    return route.fulfill({
      status: 404,
      json: { _tag: "LocationNotFoundError", directory, message: "Missing directory" } satisfies LocationNotFoundError,
      headers: { "access-control-allow-origin": "*" },
    })
  })
  await page.goto(`/server/${base64Encode(fixture.serverKey)}/session/${sessionID}`)
  await requested.promise
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true })
  await expect(prompt).toBeEditable()
  await prompt.fill("Keep typing here")
  const connection = await transport.waitForConnection()
  const metadata = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/session/${sessionID}`)
  const resolved = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.pathname === "/api/location" && url.searchParams.get("location[directory]") === directory && response.ok()
    )
  })
  await transport.close()
  await transport.waitForConnection({ after: connection.id })
  await metadata
  release.resolve()
  await resolved
  await expect(prompt).toHaveText("Keep typing here")
  await expect(page.getByRole("button", { name: "Choose directory", exact: true })).toHaveCount(0)
  expect(requests).toBe(2)
})
