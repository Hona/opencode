import { expect, test, type Page } from "@playwright/test"
import { SERVER, holdRoute, seed, sessionHref } from "../utils/app"
import { openWithDirection } from "../utils/direction"
import { mockOpenCodeServer } from "../utils/mock-server"
import { fixture, installStressSessionTabs, mockStressTimeline, pageMessages } from "../utils/session-fixture"

const cors = { "access-control-allow-origin": "*" }

for (const custom of [false, true]) {
  test(`summary toggle ${custom ? "custom" : "default"} shortcut follows the active session`, async ({ page }) => {
    await mockStressTimeline(page)
    await installStressSessionTabs(page)
    // The legacy command ID; the keybind migration renames it to `summary.toggle`.
    if (custom) await seed(page, { settings: { keybinds: { "session.summary.toggle": "f8" } } })
    await page.goto(sessionHref(fixture.sourceID))
    const trigger = page.getByRole("button", { name: "Session details", exact: true })
    const summary = page.getByRole("dialog", { name: "Session details", exact: true })
    await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
    await expect(trigger).toBeEnabled()
    await trigger.hover()
    const tooltip = page.getByRole("tooltip")
    await expect(tooltip).toContainText("Summary")
    const mac = await page.evaluate(() => /(Mac|iPod|iPhone|iPad)/.test(navigator.platform))
    const shortcut = custom ? "F8" : mac ? "Meta+Shift+Y" : "Control+Shift+Y"
    await expect(tooltip.locator('[data-slot="keybind-v2-label"]')).toHaveText(
      custom ? ["F8"] : mac ? ["⇧", "⌘", "Y"] : ["Ctrl", "Shift", "Y"],
    )
    for (const id of [fixture.targetID, fixture.sourceID]) {
      await page.locator(`[data-titlebar-tab-link][href="${sessionHref(id)}"]`).click()
      const messages = id === fixture.sourceID ? fixture.expected.sourceMessageIDs : fixture.expected.targetMessageIDs
      await expect(
        page.locator(`[data-timeline-row="UserMessage"][data-message-id="${messages.at(-1)}"]`),
      ).toBeInViewport()
      await page.keyboard.press(shortcut)
      await expect(trigger).toHaveAttribute("aria-expanded", "true")
      await expect(summary.getByRole("button", { name: "Extensions", exact: true })).toBeVisible()
      await expect.poll(() => summary.evaluate((element) => element.contains(document.activeElement))).toBe(true)
      await expect(tooltip).toBeHidden()
      await page.keyboard.press(shortcut)
      await expect(trigger).toHaveAttribute("aria-expanded", "false")
      await expect(summary).toBeHidden()
      await expect(trigger).toBeFocused()
    }
  })
}

test("summary disclosures import legacy settings and persist in extension storage", async ({ page }) => {
  await mockStressTimeline(page)
  await seed(page, {
    settings: {
      appearance: { tabLayout: "vertical" },
      sessionSummary: { projectExpanded: false, serverExpanded: true },
    },
  })
  await page.goto(sessionHref(fixture.targetID))
  const trigger = page.getByRole("button", { name: "Session details", exact: true })
  const summary = page.getByRole("dialog", { name: "Session details", exact: true })
  const project = summary.getByRole("button", { name: fixture.project.name, exact: true })
  const server = summary.getByRole("button", { name: "Extensions", exact: true })
  await trigger.click()
  await expect(project).toHaveAttribute("aria-expanded", "false")
  await expect(server).toHaveAttribute("aria-expanded", "true")
  await expect(summary.getByRole("button", { name: "MCP", exact: true })).toBeVisible()
  await server.click()
  await expect(server).toHaveAttribute("aria-expanded", "false")
  await expect(summary.getByRole("button", { name: "MCP", exact: true })).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(summary).toBeHidden()
  await expect(trigger).toBeFocused()
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("opencode.global.dat:extension.summary.prefs") ?? "null")),
    )
    .toEqual({ projectExpanded: false, serverExpanded: false })

  await page.goto(sessionHref(fixture.sourceID))
  await trigger.click()
  await expect(project).toHaveAttribute("aria-expanded", "false")
  await expect(server).toHaveAttribute("aria-expanded", "false")
  await server.click()
  await expect(summary.getByRole("button", { name: "MCP", exact: true })).toBeVisible()
})

for (const direction of ["ltr", "rtl"] as const) {
  test(`summary overlays the view and submenus follow ${direction}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const branch = `feature/${"long-branch-name-".repeat(12)}`
    await mockStressTimeline(page, { vcs: { current: branch, default: "main" } })
    await openWithDirection(page, sessionHref(fixture.targetID), direction)
    const trigger = page.getByRole("button", { name: "Session details", exact: true })
    await expect(trigger).toBeEnabled()
    await expect(page.locator("html")).toHaveAttribute("dir", direction)
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    const warnings = ownerWarnings(page)
    const row = page.locator(
      `[data-timeline-row="UserMessage"][data-message-id="${fixture.expected.targetMessageIDs.at(-1)}"]`,
    )
    const composer = page.locator('[data-component="session-composer-dock"] > div')
    const summary = page.getByRole("dialog", { name: "Session details", exact: true })
    await expect(row).toBeInViewport()
    const before = { row: (await row.boundingBox())!, composer: (await composer.boundingBox())! }

    await trigger.click()
    await expect(summary).toBeVisible()
    await expect
      .poll(async () => {
        const message = (await row.boundingBox())!
        const input = (await composer.boundingBox())!
        return Math.max(Math.abs(message.x - before.row.x), Math.abs(input.x - before.composer.x))
      })
      .toBeLessThan(1)
    await expect
      .poll(async () => {
        const message = (await row.boundingBox())!
        const details = (await summary.boundingBox())!
        return Math.min(message.x + message.width, details.x + details.width) - Math.max(message.x, details.x)
      })
      .toBeGreaterThan(0)
    const text = summary.getByText(branch, { exact: true })
    await expect(text).toHaveCSS("text-overflow", "ellipsis")
    await expect.poll(() => text.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    await expectAlignedWithHeader(page, direction)

    const mcp = summary.getByRole("button", { name: "MCP", exact: true })
    const submenu = page.getByRole("dialog", { name: "MCP", exact: true })
    await mcp.hover()
    await expect(submenu).toHaveCount(0)
    await mcp.click()
    await expect(submenu.getByText("No MCP servers configured", { exact: true })).toBeVisible()
    await expect(summary).toBeVisible()
    await expect
      .poll(async () => {
        const item = (await mcp.boundingBox())!
        const menu = (await submenu.boundingBox())!
        return direction === "ltr" ? menu.x + menu.width <= item.x : menu.x >= item.x + item.width
      })
      .toBe(true)
    await page.keyboard.press("Escape")
    await expect(submenu).toBeHidden()
    await expect(summary).toBeVisible()
    await expect(mcp).toBeFocused()
    await mcp.press("Enter")
    await expect(submenu.getByText("Configuration file")).toBeVisible()
    await mcp.click()
    await expect(submenu).toBeHidden()

    for (const [name, empty] of [
      ["Plugins", "No plugins configured"],
      ["Skills", "No skills configured"],
      ["LSP", "No LSP servers configured"],
    ]) {
      await summary.getByRole("button", { name, exact: true }).click()
      await expect(page.getByRole("dialog", { name, exact: true }).getByText(empty, { exact: true })).toBeVisible()
      await expect(submenu).toBeHidden()
    }
    await summary.getByRole("button", { name: "Extensions", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "LSP", exact: true })).toBeHidden()
    await page.keyboard.press("Escape")
    await expect(summary).toBeHidden()

    await page.getByRole("button", { name: "Toggle review", exact: true }).click()
    await trigger.click()
    await expectAlignedWithHeader(page, direction)
    expect(warnings).toEqual([])
  })
}

test("summary catalogs load, refresh while cached, and tell errors from empty", async ({ page }) => {
  const state = { fail: true, extra: false, skills: true }
  const pluginDirectories: string[] = []
  await mockStressTimeline(page, {
    mcp: [{ name: "summary-mcp", status: { status: "connected" } }],
    plugins: () => [
      { id: "builtin", source: { type: "builtin" }, features: {}, state: { status: "active" } },
      {
        id: "supermemory",
        source: { type: "package", target: "opencode-supermemory" },
        features: { server: true },
        state: { status: "active" },
      },
      {
        id: "broken-plugin",
        source: { type: "local", path: "/broken.ts" },
        features: { server: true },
        state: { status: "failed", error: "Plugin failed to activate" },
      },
      ...(state.extra
        ? [
            {
              id: "daytona",
              source: { type: "package", target: "opencode-daytona" },
              features: {},
              state: { status: "active" },
            },
          ]
        : []),
    ],
    skills: () =>
      state.skills
        ? [
            { id: "find-skills", name: "find-skills", path: "/skills/find/SKILL.md", content: "Find skills" },
            { id: "review-animations", name: "review-animations", path: "/skills/review/SKILL.md", content: "Review" },
          ]
        : [],
    configEntries: [
      {
        type: "document",
        info: {
          lsp: {
            typescript: { command: ["typescript-language-server", "--stdio"] },
            rust: { command: ["rust-analyzer"] },
          },
        },
      },
      { type: "document", info: { lsp: { rust: { disabled: true } } } },
    ],
  })
  await page.route(
    (url) => url.pathname === "/api/plugin",
    (route) => {
      if (route.request().method() === "OPTIONS") return route.fallback()
      pluginDirectories.push(new URL(route.request().url()).searchParams.get("location[directory]") ?? "")
      if (state.fail) return route.fulfill({ status: 500, headers: cors, json: { message: "Unavailable" } })
      return route.fallback()
    },
  )
  const prefetch = await holdRoute(page, (url) => url.pathname === "/api/plugin")
  const warnings = ownerWarnings(page)
  await page.goto(sessionHref(fixture.targetID))
  await page.getByRole("button", { name: "Session details", exact: true }).click()
  const summary = page.getByRole("dialog", { name: "Session details", exact: true })
  const menu = (name: string) => page.getByRole("dialog", { name, exact: true })
  const open = (name: string) => summary.getByRole("button", { name, exact: true }).click()

  await prefetch.arrived
  await expect(summary.getByRole("button", { name: fixture.project.name, exact: true })).toBeVisible()
  await expect(summary.getByRole("button", { name: "Extensions", exact: true })).toBeVisible()
  await open("Plugins")
  await expect(menu("Plugins").getByRole("status")).toContainText("Loading")
  await expect(menu("Plugins").getByText("No plugins configured", { exact: true })).toHaveCount(0)
  prefetch.release()
  await expect(menu("Plugins").getByRole("alert")).toContainText("Request failed")
  await expect(menu("Plugins").getByText("No plugins configured", { exact: true })).toHaveCount(0)

  state.fail = false
  await menu("Plugins").getByRole("button", { name: "Retry", exact: true }).click()
  await expect(menu("Plugins").getByText("supermemory", { exact: true })).toBeVisible()
  await expect(menu("Plugins").getByText("builtin", { exact: true })).toHaveCount(0)
  await expect(menu("Plugins").getByTitle("Plugin failed to activate")).toContainText("Failed")
  expect(pluginDirectories.length).toBeGreaterThan(1)
  expect(pluginDirectories.every((directory) => directory === fixture.directory)).toBe(true)

  await open("Skills")
  await expect(menu("Skills").getByText("find-skills", { exact: true })).toBeVisible()
  await expect(menu("Skills").getByText("review-animations", { exact: true })).toBeVisible()
  await expect(menu("Plugins")).toBeHidden()
  await open("LSP")
  await expect(menu("LSP").getByText("Configured LSPs", { exact: true })).toBeVisible()
  await expect(menu("LSP").getByText("typescript", { exact: true })).toBeVisible()
  await expect(menu("LSP").getByText("rust", { exact: true })).toHaveCount(0)
  await expect(menu("LSP").locator(".session-service-dot")).toHaveCount(0)
  await open("MCP")
  await expect(menu("MCP").getByText("summary-mcp", { exact: true })).toBeVisible()

  for (const service of [
    { name: "MCP", path: "/api/mcp", item: "summary-mcp" },
    { name: "Plugins", path: "/api/plugin", item: "supermemory" },
    { name: "Skills", path: "/api/skill", item: "find-skills" },
    { name: "LSP", path: "/api/config", item: "typescript" },
  ]) {
    await expectRefreshKeeps(page, service.name, service.path, service.item)
  }

  state.extra = true
  state.skills = false
  await open("Plugins")
  await expect(menu("Plugins").getByText("daytona", { exact: true })).toBeVisible()
  await open("Skills")
  await expect(menu("Skills").getByText("No skills configured", { exact: true })).toBeVisible()
  await expectRefreshKeeps(page, "Skills", "/api/skill", "No skills configured")
  expect(warnings).toEqual([])
})

test("every MCP row hit area toggles exactly once and keeps the submenu open", async ({ page }) => {
  await mockStressTimeline(page)
  const state = { enabled: true }
  const writes: string[] = []
  await page.route(/\/api\/(?:experimental\/)?mcp(?:[/?]|$)/, (route) => {
    if (route.request().method() === "OPTIONS") return route.fallback()
    const url = new URL(route.request().url())
    const directory = url.searchParams.get("location[directory]")
    if (route.request().method() === "POST") {
      expect(directory).toBe(fixture.directory)
      writes.push(url.pathname)
      state.enabled = url.pathname.endsWith("/connect")
      return route.fulfill({ status: 204 })
    }
    return route.fulfill({
      json: {
        location: { directory: fixture.directory },
        data:
          url.pathname === "/api/mcp/resource"
            ? { resources: [], templates: [] }
            : [
                { name: "figma", status: { status: state.enabled ? "connected" : "disabled" } },
                { name: "linear", status: { status: "needs_auth" }, integrationID: "linear-oauth" },
                { name: "playwright", status: { status: "failed", error: "Connection refused" } },
                { name: "waiting", status: { status: "pending" } },
              ],
      },
    })
  })
  await page.goto(sessionHref(fixture.targetID))
  await page.getByRole("button", { name: "Session details", exact: true }).click()
  await page.getByRole("button", { name: "MCP", exact: true }).click()
  const submenu = page.getByRole("dialog", { name: "MCP", exact: true })
  const toggle = submenu.getByRole("switch", { name: "figma", exact: true })
  const row = submenu
    .locator('[data-component="switch"]')
    .filter({ has: page.getByRole("switch", { name: "figma", exact: true }) })
  await expect(toggle).toBeChecked()
  await expect(submenu.getByRole("switch", { name: "playwright", exact: true })).toBeChecked()
  await expect(submenu.getByRole("switch", { name: "playwright", exact: true })).toHaveAccessibleDescription("Failed")
  await expect(submenu.getByRole("switch", { name: "waiting", exact: true })).toBeDisabled()
  await expect(submenu.getByRole("switch", { name: "waiting", exact: true })).toHaveAccessibleDescription("Connecting…")
  await expect(submenu.getByRole("switch", { name: "linear", exact: true })).toHaveAccessibleDescription(
    "Sign in required",
  )

  for (const [index, target] of ["label", "dot", "padding", "control", "keyboard"].entries()) {
    const enabled = index % 2 !== 0
    await expect(toggle).toBeEnabled()
    if (target === "label") await row.getByText("figma", { exact: true }).click()
    if (target === "dot") await row.locator(".session-service-dot").click()
    if (target === "padding") await row.click({ position: { x: 3, y: 3 } })
    if (target === "control") await row.locator('[data-slot="switch-control"]').click()
    if (target === "keyboard") await toggle.press("Space")
    await expect(toggle).toBeChecked({ checked: enabled })
    await expect(toggle).toBeEnabled()
    await expect(submenu).toBeVisible()
    if (target === "keyboard") await expect(toggle).toBeFocused()
    expect(writes).toHaveLength(index + 1)
    expect(writes[index]).toBe(`/api/experimental/mcp/figma/${enabled ? "connect" : "disconnect"}`)
  }
})

test("MCP authentication starts before a slow resource catalog finishes", async ({ page, context }) => {
  await mockStressTimeline(page)
  const state = { status: "disabled" }
  const attempts: string[] = []
  const resources = Promise.withResolvers<void>()
  await context.route("https://auth.example.test/**", (route) => route.fulfill({ body: "Sign in" }))
  await page.route(/\/api\/(?:experimental\/)?mcp(?:[/?]|$)/, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fallback()
    const url = new URL(route.request().url())
    if (url.pathname.endsWith("/connect")) {
      state.status = "needs_auth"
      return route.fulfill({ status: 204 })
    }
    if (url.pathname === "/api/mcp/resource" && state.status === "needs_auth") await resources.promise
    return route.fulfill({
      json: {
        location: { directory: fixture.directory },
        data:
          url.pathname === "/api/mcp/resource"
            ? { resources: [], templates: [] }
            : [{ name: "linear", integrationID: "linear-oauth", status: { status: state.status } }],
      },
    })
  })
  await page.route("**/api/integration/**", (route) => {
    if (route.request().method() === "OPTIONS") return route.fallback()
    if (route.request().method() === "POST") {
      attempts.push(route.request().url())
      return route.fulfill({
        json: { location: { directory: fixture.directory }, data: { url: "https://auth.example.test/authorize" } },
      })
    }
    return route.fulfill({
      json: {
        location: { directory: fixture.directory },
        data: { id: "linear-oauth", methods: [{ id: "oauth", type: "oauth" }] },
      },
    })
  })
  await page.goto(sessionHref(fixture.targetID))
  await page.getByRole("button", { name: "Session details", exact: true }).click()
  await page.getByRole("button", { name: "MCP", exact: true }).click()
  const submenu = page.getByRole("dialog", { name: "MCP", exact: true })
  const toggle = submenu.getByRole("switch", { name: "linear", exact: true })
  await expect(toggle).toBeEnabled()
  const refresh = page.waitForRequest(
    (request) =>
      state.status === "needs_auth" &&
      new URL(request.url()).pathname === "/api/mcp/resource" &&
      request.method() === "GET",
  )
  try {
    const popup = page.waitForEvent("popup")
    await submenu.getByText("linear", { exact: true }).click()
    await expect(await popup).toHaveURL("https://auth.example.test/authorize")
    await refresh
    await expect(toggle).toBeChecked()
    await expect(toggle).toHaveAccessibleDescription("Sign in required")
  } finally {
    resources.resolve()
  }
  await expect(toggle).toBeEnabled()
  expect(attempts).toHaveLength(1)
  expect(new URL(attempts[0]).searchParams.get("location[directory]")).toBe(fixture.directory)
})

test("multiple desktop connections show the session's server name", async ({ page }) => {
  await mockStressTimeline(page)
  await page.route("http://secondary.test/**", (route) =>
    route.fulfill({
      json: { version: "2.0.0", pid: 1, urls: ["http://secondary.test"], paths: { tmp: "/tmp/opencode" } },
    }),
  )
  await seed(page, {
    servers: [
      { url: SERVER, name: "Design server" },
      { url: "http://secondary.test", name: "Other server" },
    ],
    projects: { local: [{ worktree: fixture.directory, expanded: true }] },
  })
  await page.goto(sessionHref(fixture.targetID))
  await page.getByRole("button", { name: "Session details", exact: true }).click()
  const summary = page.getByRole("dialog", { name: "Session details", exact: true })
  await expect(summary.getByRole("button", { name: "Design server", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  )
  await expect(summary.getByRole("button", { name: "Extensions", exact: true })).toHaveCount(0)
})

test.describe("remote configuration", () => {
  test.use({ serviceWorkers: "block", permissions: ["clipboard-read", "clipboard-write"] })

  test("remote servers copy each service's configuration path", async ({ page }) => {
    const remote = "http://summary-remote.test:4096"
    const home = "/home/remote/.config/opencode"
    const entries = [
      { type: "document", path: `${home}/mcp.jsonc`, info: { mcp: { servers: {} } } },
      { type: "document", path: `${home}/plugins.json`, info: { plugins: [] } },
      { type: "document", path: `${home}/skills.jsonc`, info: { skills: [] } },
      { type: "document", path: `${home}/lsp.json`, info: { lsp: false } },
      { type: "document", path: `${fixture.directory}/opencode.json`, info: {} },
      { type: "document", path: `${fixture.directory}/.opencode/agents/review.md`, info: {} },
    ]
    await mockOpenCodeServer(page, {
      server: remote,
      sessions: fixture.sessions,
      provider: fixture.provider,
      directory: fixture.directory,
      project: fixture.project,
      pageMessages,
      configEntries: entries,
    })
    await seed(page, { servers: [{ url: remote, name: "Remote server" }] })
    await page.goto(sessionHref(fixture.targetID, remote))
    const trigger = page.getByRole("button", { name: "Session details", exact: true })
    const summary = page.getByRole("dialog", { name: "Session details", exact: true })
    const tooltip = page.getByRole("tooltip")

    // Each service opens from a fresh summary: after a copy, the next submenu closes itself (reported defect).
    for (const [index, service] of [
      { name: "MCP", path: `${home}/mcp.jsonc` },
      { name: "Plugins", path: `${home}/plugins.json` },
      { name: "Skills", path: `${home}/skills.jsonc` },
      { name: "LSP", path: `${home}/lsp.json` },
    ].entries()) {
      await trigger.click()
      await summary.getByRole("button", { name: service.name, exact: true }).click()
      const menu = page.getByRole("dialog", { name: service.name, exact: true })
      const copy = menu.getByRole("button", { name: "Copy configuration file path", exact: true })
      await expect(tooltip).toHaveCount(0)
      await copy.hover()
      await expect(tooltip).toHaveText("Copy")
      if (index === 0) {
        await expect
          .poll(async () => {
            const icon = (await copy.locator("svg").boundingBox())!
            const tip = (await tooltip.boundingBox())!
            return Math.abs(tip.x + tip.width / 2 - icon.x - icon.width / 2)
          })
          .toBeLessThanOrEqual(1)
      }
      await copy.click()
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(service.path)
      await expect(tooltip).toHaveText("Copied")
      await expect(menu).toBeVisible()
      await trigger.click()
      await expect(summary).toBeHidden()
    }

    entries.length = 0
    await page.evaluate(() => navigator.clipboard.writeText("original clipboard"))
    await trigger.click()
    await summary.getByRole("button", { name: "Skills", exact: true }).click()
    const copy = page
      .getByRole("dialog", { name: "Skills", exact: true })
      .getByRole("button", { name: "Copy configuration file path", exact: true })
    await copy.click()
    await expect(page.getByText("No configuration file found", { exact: true })).toBeVisible()
    await expect(copy).toBeEnabled()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("original clipboard")
  })
})

test("long MCP lists stay in the viewport in a real RTL locale", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 })
  await mockStressTimeline(page, {
    mcp: Array.from({ length: 30 }, (_, index) => ({
      name: `server-${String(index).padStart(2, "0")}-בדיקה-${"long-name-".repeat(6)}`,
      status: { status: "connected" },
    })),
  })
  await seed(page, { locale: "he", theme: { id: "oc-2", scheme: "dark" } })
  await page.goto(sessionHref(fixture.targetID))
  await page.getByRole("button", { name: "פרטי ההפעלה", exact: true }).click()
  const summary = page.locator('[data-component="session-summary-panel"]')
  await summary.getByRole("button", { name: "MCP", exact: true }).click()
  const menu = page.getByRole("dialog", { name: "MCP", exact: true })
  await expect(menu.getByRole("switch")).toHaveCount(30)
  await expect.poll(() => menu.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await expect
    .poll(async () => {
      const bounds = (await menu.boundingBox())!
      return bounds.x >= 15 && bounds.y >= 15 && bounds.x + bounds.width <= 785 && bounds.y + bounds.height <= 585
    })
    .toBe(true)
  const last = menu.getByRole("switch", { name: /^server-29-/ })
  await last.focus()
  await expect(last).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  await expect(summary.getByRole("button", { name: "MCP", exact: true })).toBeFocused()
})

// Solid reports reactive work created without an owner; the warning appears in dev builds only.
function ownerWarnings(page: Page) {
  const warnings: string[] = []
  page.on("console", (event) => {
    if (event.text().includes("computations created outside")) warnings.push(event.text())
  })
  return warnings
}

async function expectAlignedWithHeader(page: Page, direction: "ltr" | "rtl") {
  const summary = page.getByRole("dialog", { name: "Session details", exact: true })
  await expect(summary).toBeVisible()
  await expect
    .poll(async () => {
      const header = (await page.locator("[data-session-title]").boundingBox())!
      const panel = (await summary.boundingBox())!
      return direction === "ltr"
        ? Math.abs(header.x + header.width - panel.x - panel.width - 12)
        : Math.abs(panel.x - header.x - 12)
    })
    .toBeLessThanOrEqual(1)
}

// Reopens a service submenu while its next catalog request is held: the cached content stays, marked busy.
async function expectRefreshKeeps(page: Page, name: string, path: string, content: string) {
  const menu = page.getByRole("dialog", { name, exact: true })
  const summary = page.getByRole("dialog", { name: "Session details", exact: true })
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  const refresh = await holdRoute(page, (url) => url.pathname === path, { method: "GET" })
  await summary.getByRole("button", { name, exact: true }).click()
  await refresh.arrived
  await expect(menu).toHaveAttribute("aria-busy", "true")
  await expect(menu.getByText(content, { exact: true })).toBeVisible()
  await expect(menu.getByRole("status")).toHaveCount(0)
  await expect(summary).toBeVisible()
  refresh.release()
  await expect(menu).toHaveAttribute("aria-busy", "false")
  await expect(menu.getByText(content, { exact: true })).toBeVisible()
}
