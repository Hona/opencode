import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/OpenCode/PwaNavigation"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

// Browser smoke coverage only: native status-bar hit testing requires an installed iOS PWA.
for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true })

    test("keeps home and new-session navigation usable", async ({ page }) => {
      await mockOpenCodeServer(page, {
        directory,
        project: {
          id: "proj_pwa_navigation",
          worktree: directory,
          vcs: "git",
          name: "pwa-navigation",
          time: { created: 1700000000000, updated: 1700000000000 },
          sandboxes: [],
        },
        provider: { all: [], connected: [], default: {} },
        sessions: [],
        pageMessages: () => ({ items: [] }),
      })
      await page.addInitScript(
        ({ directory, server }) => {
          localStorage.setItem(
            "opencode.global.dat:server",
            JSON.stringify({
              projects: { [server]: [{ worktree: directory, expanded: true }] },
              lastProject: { [server]: directory },
            }),
          )
        },
        { directory, server },
      )

      await page.goto("/")
      await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute(
        "content",
        "default",
      )
      const titlebar = page.locator('[data-slot="titlebar-v2"]')
      const home = titlebar.getByRole("button", { name: "Home", exact: true })
      const create = titlebar.getByRole("button", { name: "New session", exact: true })
      await expect(home).toHaveAttribute("aria-pressed", "true")
      await expect(page.getByText("pwa-navigation", { exact: true })).toBeVisible()
      await expect(create).toBeInViewport({ ratio: 1 })
      await create.tap()
      await expect(page).toHaveURL(/\/new-session\?draftId=.+/)
      await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
      await expect(home).toHaveAttribute("aria-pressed", "false")
      await home.tap()
      await expect(page).toHaveURL(/\/$/)
      await expect(home).toHaveAttribute("aria-pressed", "true")
    })
  })
}
