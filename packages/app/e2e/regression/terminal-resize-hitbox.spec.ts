import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/TerminalResizeHitbox"
const sessionID = "ses_terminal_resize_hitbox"

test("terminal resize handle fills the visible gutter", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_terminal_resize_hitbox",
      worktree: directory,
      vcs: "git",
      name: "terminal-resize-hitbox",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [{ id: "opencode", name: "OpenCode", models: {} }],
      connected: ["opencode"],
      default: {},
    },
    sessions: [
      {
        id: sessionID,
        projectID: "proj_terminal_resize_hitbox",
        directory,
        title: "Terminal resize hitbox",
        version: "1.0.0",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, "Terminal resize hitbox")
  await page.keyboard.press("Control+Backquote")

  const panel = page.locator("#terminal-panel")
  await expect(panel).toHaveAttribute("aria-hidden", "false")
  await panel.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined))),
  )

  const hits = await panel.evaluate((element) => {
    const handle = element.querySelector('[data-component="resize-handle"]')
    if (!(handle instanceof HTMLElement)) throw new Error("missing terminal resize handle")

    const panelBox = element.getBoundingClientRect()
    const handleBox = handle.getBoundingClientRect()
    return {
      top: handleBox.top - panelBox.top,
      bottom: handleBox.bottom - panelBox.top,
      pixels: Array.from({ length: 8 }, (_, offset) => offset - 7.5).map(
        (offset) =>
          document
            .elementFromPoint(handleBox.left + handleBox.width / 2, panelBox.top + offset)
            ?.getAttribute("data-component") === "resize-handle",
      ),
    }
  })

  expect(hits).toEqual({
    top: -8,
    bottom: 0,
    pixels: [true, true, true, true, true, true, true, true],
  })
})

function base64Encode(value: string) {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}
