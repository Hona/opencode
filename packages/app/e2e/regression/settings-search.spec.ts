import { expect, test, type Page } from "@playwright/test"
import en from "../../src/runtime/i18n/en"
import { clientSettings } from "../../src/settings/search-catalog"
import { NO_PROVIDER, REMOTE_SERVER, project, type SeedInput } from "../utils/app"
import { mockOpenCodeServer } from "../utils/mock-server"
import { openSettings } from "../utils/workspace"

const directory = "/projects/opencode"

test.use({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" })

// `count` replaces the single "OpenCode" project with "OpenCode 00".."OpenCode NN".
async function open(page: Page, input: { count?: number; seed?: SeedInput } = {}) {
  const projects =
    input.count === undefined
      ? undefined
      : Array.from({ length: input.count }, (_, index) =>
          project({
            id: `proj_search_${index}`,
            directory: `${directory}-${index}`,
            name: `OpenCode ${String(index).padStart(2, "0")}`,
          }),
        )
  await page.route("https://api.github.com/**", (route) => route.fulfill({ json: [] }))
  const { settings } = await openSettings(page, {
    name: "OpenCode",
    directory,
    project: { icon: { color: "orange" } },
    provider: NO_PROVIDER,
    projects,
    seed: {
      tabs: [],
      ...(projects ? { projects: { local: projects.map((item) => ({ worktree: item.worktree })) } } : {}),
      ...input.seed,
    },
  })
  const view = {
    settings,
    search: settings.getByRole("combobox", { name: "Search", exact: true }),
    results: settings.getByRole("listbox", { name: "Settings results", exact: true }),
    viewport: settings.locator(".settings-search-scroll > .scroll-view__viewport"),
  }
  // Readiness includes the server-backed project inventory, not just the settings shell.
  if (input.count === 0) return view
  await view.search.fill("OpenCode")
  await expect(view.results.getByRole("option")).toHaveCount(input.count ?? (input.seed?.servers ? 2 : 1))
  await view.search.clear()
  return view
}

async function findShortcut(page: Page) {
  // Browser emulation can report a different OS than the machine running Playwright.
  const key = await page.evaluate(() => (/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "Meta+f" : "Control+f"))
  await page.keyboard.press(key)
}

test("pointer selection, keyboard navigation, the empty state, and the local find shortcut", async ({ page }) => {
  const view = await open(page)
  await view.search.fill("font")
  const code = view.results.getByRole("option", { name: "Code Font, Appearance", exact: true })
  const terminal = view.results.getByRole("option", { name: "Terminal Font, Appearance", exact: true })
  const font = view.results.getByRole("option", { name: "UI Font, Appearance", exact: true })
  await expect(view.results.getByRole("option")).toHaveText([
    "Code FontAppearance",
    "Terminal FontAppearance",
    "UI FontAppearance",
  ])
  await code.click()
  await expect(code).toBeFocused()
  await expect(view.settings.getByRole("textbox", { name: "Code Font", exact: true })).toBeInViewport()
  await code.press("ArrowDown")
  await expect(terminal).toBeFocused()
  await expect(terminal).toHaveAttribute("aria-selected", "true")
  await terminal.press("Enter")
  await expect(terminal).toBeFocused()
  await expect(view.settings.getByRole("textbox", { name: "Terminal Font", exact: true })).toBeInViewport()
  await expect(view.settings.locator('[data-search-target="row"]')).toContainText("Terminal Font")
  await terminal.press("End")
  await expect(font).toBeFocused()
  await font.press("Home")
  await expect(code).toBeFocused()
  await findShortcut(page)
  await expect(view.search).toBeFocused()
  expect(await view.search.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([
    0, 4,
  ])

  await view.search.fill("zzzzzzzzzz")
  await expect(view.results.getByRole("option")).toHaveCount(0)
  await expect(view.settings.getByRole("status")).toHaveText('No results for "zzzzzzzzzz"')
  await view.search.press("Escape")
  await expect(view.search).toHaveValue("")

  // The narrow layout collapses the results once a result is picked.
  await page.setViewportSize({ width: 390, height: 844 })
  await view.search.fill("terminal font")
  await view.results.getByRole("option").click()
  await expect(view.results).toBeHidden()
  await expect(view.search).toHaveAttribute("aria-expanded", "false")
  await expect(view.search).not.toHaveAttribute("aria-activedescendant", /.+/)
  await findShortcut(page)
  await expect(view.search).toBeFocused()
  await expect(view.results).toBeVisible()
  await expect(view.search).toHaveAttribute("aria-activedescendant", /.+/)

  await page.setViewportSize({ width: 1280, height: 900 })
  await view.settings.getByRole("button", { name: "Back to app", exact: true }).click()
  await expect(view.settings).toBeHidden()
  await findShortcut(page)
  await expect(page.getByRole("textbox", { name: /Search sessions/ })).toBeFocused()
})

test("section search takes typed input, clears in place, and escapes in steps", async ({ page }) => {
  const view = await open(page, { count: 8 })
  await view.settings.getByRole("tab", { name: "Projects", exact: true }).click()
  const field = view.settings.locator('[data-component="settings-filter-search"]')
  const search = field.getByRole("searchbox", { name: "Search projects", exact: true })
  await expect(search).not.toBeFocused()

  await page.keyboard.type("missing-project")
  await expect(search).toBeFocused()
  await expect(search).toHaveValue("missing-project")
  await expect(view.settings.getByText('No results for "missing-project"', { exact: true })).toBeVisible()
  await field.getByRole("button", { name: "Clear", exact: true }).click()
  await expect(search).toHaveValue("")
  await expect(search).toBeFocused()

  await search.fill("missing-project")
  await search.press("Escape")
  await expect(search).toHaveValue("")
  await expect(search).toBeFocused()
  await search.press("Escape")
  await expect(search).not.toBeFocused()
  await expect(view.settings).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(view.settings).toBeHidden()
  await expect(page).toHaveURL("/")
})

for (const count of [0, 7, 8]) {
  test(`Projects search appears from 8 projects (${count} projects)`, async ({ page }) => {
    const view = await open(page, { count })
    await view.settings.getByRole("tab", { name: "Projects", exact: true }).click()
    const search = view.settings.getByRole("searchbox", { name: "Search projects", exact: true })
    const projects = view.settings.getByRole("button", { name: /^OpenCode / })
    if (count === 0) {
      await expect(view.settings.getByText("No projects yet", { exact: true })).toBeVisible()
      await view.settings.getByRole("button", { name: "Add project", exact: true }).click()
      const picker = page.getByRole("dialog", { name: "Open project", exact: true })
      await expect(picker).toBeVisible()
      await picker.getByRole("button", { name: "Cancel", exact: true }).click()
      await expect(picker).toBeHidden()
      return
    }
    await expect(projects).toHaveCount(count)
    if (count === 7) {
      await expect(search).toHaveCount(0)
      return
    }
    await search.fill("  CODE 06  ")
    await expect(projects).toHaveCount(1)
    await expect(projects).toHaveAccessibleName("OpenCode 06")
    await search.fill("missing-project")
    await expect(projects).toHaveCount(0)
    await view.settings.getByRole("button", { name: "Clear", exact: true }).click()
    await expect(projects).toHaveCount(count)
    await search.fill("OpenCode 06")
    await projects.click()
    await expect(view.settings.getByRole("heading", { name: "OpenCode 06", exact: true })).toBeVisible()
  })
}

test("all indexed client controls resolve to visible production controls", async ({ page }) => {
  const view = await open(page)
  for (const entry of clientSettings.filter((entry) => entry.target && !entry.available)) {
    await view.search.fill(en[entry.label as keyof typeof en])
    const result = view.results.locator(`[data-setting-target="${entry.target}"]`)
    await expect(result).toHaveCount(1)
    await result.click()
    await expect(view.settings.locator(`[data-action="${entry.target}"]`)).toBeInViewport()
  }
})

test("project results keep the query, selection, and scroll position on return", async ({ page }) => {
  const view = await open(page, { count: 30 })
  await view.search.fill("OpenCode 25 name")
  const name = view.results.getByRole("option")
  await expect(name).toHaveText("Project nameGeneral")
  await name.click()
  await expect(view.search).toHaveCount(0)
  await expect(view.settings.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue("OpenCode 25")
  await page.keyboard.press("Escape")
  await expect(view.search).toBeFocused()
  await expect(view.search).toHaveValue("OpenCode 25 name")
  await expect(name).toHaveAttribute("aria-selected", "true")

  await view.search.fill("OpenCode")
  await expect(view.results.getByRole("option")).toHaveCount(30)
  const target = view.results.getByRole("option", { name: /^OpenCode 25,/ })
  await target.scrollIntoViewIfNeeded()
  await expect.poll(() => view.viewport.evaluate((list) => list.scrollTop)).toBeGreaterThan(0)
  const scroll = await view.viewport.evaluate((list) => list.scrollTop)
  await target.click()
  await expect(view.settings.getByRole("heading", { name: "OpenCode 25", exact: true })).toBeVisible()
  await view.settings.getByRole("button", { name: "Back to settings", exact: true }).click()
  await expect(view.search).toBeFocused()
  await expect(target).toHaveAttribute("aria-selected", "true")
  await expect.poll(() => view.viewport.evaluate((list) => list.scrollTop)).toBe(scroll)
})

test("IME confirmation does not activate a search result", async ({ page }) => {
  const view = await open(page)
  await view.search.fill("font")
  await expect(view.results.getByRole("option")).toHaveCount(3)
  await view.search.dispatchEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })
  await expect(view.settings.getByRole("heading", { name: "Preferences", exact: true })).toBeVisible()
  await view.search.press("Enter")
  await expect(view.settings.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible()
})

test("multi-server results navigate to the named server and keep the query on return", async ({ page }) => {
  await mockOpenCodeServer(page, {
    server: REMOTE_SERVER,
    directory: "/remote/opencode",
    project: project({ id: "proj_search_remote", directory: "/remote/opencode", name: "OpenCode" }),
    provider: NO_PROVIDER,
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  const view = await open(page, {
    seed: {
      servers: [{ url: REMOTE_SERVER, name: "Build server" }],
      projects: {
        local: [{ worktree: directory, expanded: true }],
        [REMOTE_SERVER]: [{ worktree: "/remote/opencode", expanded: true }],
      },
    },
  })
  await view.search.fill("MCPs")
  await expect(view.results.getByRole("option")).toHaveCount(2)
  await view.results.getByRole("option", { name: "MCPs, Build server, Extensions", exact: true }).click()
  await expect(view.search).toHaveCount(0)
  await expect(view.settings.getByRole("tab", { name: "Build server", exact: true })).toBeVisible()
  await expect(view.settings.getByRole("tab", { name: "MCPs", exact: true })).toHaveAttribute("aria-selected", "true")
  await view.settings.getByRole("button", { name: "Back to settings", exact: true }).click()
  await expect(view.search).toHaveValue("MCPs")
  await view.search.fill("Build server OpenCode name")
  await expect(view.results.getByRole("option")).toHaveCount(1)
  await view.results.getByRole("option").click()
  await expect(view.settings.getByRole("button", { name: "Build server", exact: true })).toBeVisible()
  await expect(view.settings.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue("OpenCode")
})
