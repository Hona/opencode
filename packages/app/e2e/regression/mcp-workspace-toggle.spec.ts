import { expect, test, type Page } from "@playwright/test"
import { NO_PROVIDER, sessionHref } from "../utils/app"
import { mockWorkspace } from "../utils/workspace"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:\\OpenCode\\main"
const workspace = "C:\\OpenCode\\worktree"
const sessionID = "ses_mcp_workspace"
const title = "Workspace MCP routing"

type Surface = "popover" | "dialog"

// A session in a worktree of the project; `list` answers the MCP list for each location directory.
// The popover belongs to the summary extension; the dialog (Ctrl+;) is the app's own MCP toggle.
async function open(
  page: Page,
  input: { surface: Surface; list: (target: string) => unknown[]; action: (name: string, target: string) => void },
) {
  const requests: { path: string; directory: string }[] = []
  await mockWorkspace(page, {
    name: "mcp-workspace",
    directory,
    project: { sandboxes: [workspace] },
    provider: NO_PROVIDER,
    sessions: [{ id: sessionID, title, directory: workspace }],
    seed: { settings: { keybinds: { "mcp.toggle": "ctrl+;" } } },
  })
  await page.route(/\/api\/(?:experimental\/)?mcp(?:[/?]|$)/, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fallback()
    const url = new URL(route.request().url())
    const target = url.searchParams.get("location[directory]") ?? directory
    requests.push({ path: url.pathname, directory: target })
    const action = url.pathname.match(/^\/api\/experimental\/mcp\/figma-desktop\/(connect|disconnect)$/)?.[1]
    if (action) {
      input.action(action, target)
      // Connection failures are reported by the refreshed status, not the HTTP response.
      return route.fulfill({ status: 204 })
    }
    return route.fulfill({
      json: {
        location: { directory: target },
        data: url.pathname === "/api/mcp/resource" ? { resources: [], templates: [] } : input.list(target),
      },
    })
  })
  await page.goto(sessionHref(sessionID))
  await expectSessionTitle(page, title)
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
  const panel = page.getByRole("dialog", { name: input.surface === "popover" ? "MCP" : "MCPs", exact: true })
  const show = async () => {
    if (input.surface === "dialog") return page.keyboard.press("Control+;")
    await page.getByRole("button", { name: "Session details", exact: true }).click()
    await page.getByRole("button", { name: "MCP", exact: true }).click()
  }
  await show()
  await expect(panel.getByText("figma-desktop", { exact: true })).toBeVisible()
  return { requests, panel, show, toggle: panel.getByRole("switch") }
}

for (const shared of [true, false]) {
  test(`toggles the workspace MCP when the default location ${shared ? "has" : "does not have"} the server`, async ({
    page,
  }) => {
    const connected = new Set<string>()
    const view = await open(page, {
      surface: "popover",
      list: (target) =>
        !shared && target !== workspace
          ? []
          : [{ name: "figma-desktop", status: { status: connected.has(target) ? "connected" : "disabled" } }],
      action: (name, target) => (name === "connect" ? connected.add(target) : connected.delete(target)),
    })
    await expect(view.toggle).not.toBeChecked()
    await expect(view.toggle).toBeEnabled()
    view.requests.length = 0

    await view.panel.locator('[data-slot="switch-control"]').click()
    await expect(view.toggle).toBeChecked()
    await expect(view.toggle).toBeEnabled()
    expect(connected).toEqual(new Set([workspace]))
    expect(view.requests).toContainEqual({ path: "/api/experimental/mcp/figma-desktop/connect", directory: workspace })
    expect(view.requests).toContainEqual({ path: "/api/mcp/resource", directory: workspace })
    expect(view.requests.every((request) => request.directory === workspace)).toBe(true)

    view.requests.length = 0
    await view.panel.getByText("figma-desktop", { exact: true }).click()
    await expect(view.toggle).not.toBeChecked()
    await expect(view.toggle).toBeEnabled()
    expect(connected.size).toBe(0)
    expect(view.requests).toContainEqual({
      path: "/api/experimental/mcp/figma-desktop/disconnect",
      directory: workspace,
    })
    expect(view.requests.every((request) => request.directory === workspace)).toBe(true)
  })
}

for (const surface of ["popover", "dialog"] as const) {
  test(`shows connection failures from the MCP ${surface} and allows reconnecting`, async ({ page }) => {
    const error = "Streamable HTTP error: Error POSTing to endpoint: 404 Not Found"
    const state = { fail: true, status: surface === "popover" ? "failed" : "disabled" }
    const view = await open(page, {
      surface,
      list: (target) => [
        { name: "figma-desktop", status: { status: target === workspace ? state.status : "connected", error } },
      ],
      action: (name) => {
        state.status = name === "disconnect" ? "disabled" : state.fail ? "failed" : "connected"
      },
    })
    // A failed server shows as enabled in the popover; switch it off first.
    const reset = async () => {
      if (surface !== "popover") return
      await expect(view.toggle).toBeChecked()
      await view.panel.getByText("figma-desktop", { exact: true }).click()
    }
    await reset()
    await expect(view.toggle).not.toBeChecked()
    await expect(view.toggle).toBeEnabled()
    view.requests.length = 0

    await view.panel.locator('[data-slot="switch-control"]').click()
    const toast = page
      .getByRole("listitem", { includeHidden: true })
      .filter({ has: page.getByText("Request failed", { exact: true }) })
    await expect(toast.getByText(`figma-desktop: ${error}`, { exact: true })).toBeVisible()
    await expect(view.toggle).toBeChecked({ checked: surface === "popover" })
    await expect(view.toggle).toBeEnabled()
    expect(view.requests.filter((request) => request.path.endsWith("/connect"))).toEqual([
      { path: "/api/experimental/mcp/figma-desktop/connect", directory: workspace },
    ])
    expect(view.requests.every((request) => request.directory === workspace)).toBe(true)

    if (surface === "popover") await page.keyboard.press("Escape")
    if (surface === "dialog") await view.panel.getByRole("button", { name: "Close", exact: true }).click()
    await expect(view.panel).toBeHidden()
    await toast.getByRole("button", { name: "Dismiss", exact: true }).click()
    await expect(toast).toBeHidden()
    state.fail = false
    await expect(page.getByRole("dialog", { name: "Session details", exact: true })).toBeHidden()
    await view.show()
    await reset()
    await expect(view.toggle).not.toBeChecked()
    await expect(view.toggle).toBeEnabled()
    await view.panel.locator('[data-slot="switch-control"]').click()
    await expect(view.toggle).toBeChecked()
    await expect(view.toggle).toBeEnabled()
    await expect(toast).toBeHidden()
  })
}
