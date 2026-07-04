import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const draftID = "draft_new_session_window_corner"
const directory = "C:/OpenCode/NewSessionWindowCorner"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.use({
  viewport: { width: 935, height: 522 },
  deviceScaleFactor: 1,
})

test("matches the rounded window corner to the dark new-session background", async ({ page }, testInfo) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_new_session_window_corner",
      worktree: directory,
      vcs: "git",
      name: "new-session-window-corner",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(({ directory, draftID, server }) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem("opencode-theme-id", "oc-2")
    localStorage.setItem("opencode-color-scheme", "dark")
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: { local: directory },
      }),
    )
    localStorage.setItem(
      "opencode.window.browser.dat:tabs",
      JSON.stringify([{ type: "draft", draftID, server, directory }]),
    )
    Object.defineProperty(window, "api", {
      value: {
        setBackgroundColor: async (color: string) => {
          document.documentElement.dataset.windowBackground = color
        },
      },
    })
  }, { directory, draftID, server })

  await page.goto(`/new-session?draftId=${draftID}`)
  await expectAppVisible(page.locator('[data-component="prompt-input"]'))
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")

  const screenshot = await page.screenshot({ path: testInfo.outputPath("new-session-dark.png") })
  const corner = await page.evaluate(async (source) => {
    const image = new Image()
    image.src = source
    await image.decode()
    const canvas = document.createElement("canvas")
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext("2d")
    if (!context) throw new Error("2D canvas is unavailable")
    context.drawImage(image, 0, 0)
    return Array.from(context.getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data)
  }, `data:image/png;base64,${screenshot.toString("base64")}`)

  expect(corner).toEqual([8, 8, 8, 255])
  await expect(page.locator("html")).toHaveAttribute("data-window-background", "rgb(8, 8, 8)")
})
