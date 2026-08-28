import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible, expectSessionReady } from "../utils/waits"

const directory = "C:/OpenCode/NewProject"

test("creates a session in a new project and selects its model", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_model_selection_flow",
      worktree: directory,
      vcs: "git",
      name: "NewProject",
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      sandboxes: [],
    },
    provider: () => ({
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "free-model": {
              id: "free-model",
              name: "Free Model",
              cost: { input: 0, output: 0 },
              limit: { context: 200_000 },
            },
          },
        },
        {
          id: "opencode-go",
          name: "OpenCode Go",
          models: {
            "go-model-1": {
              id: "go-model-1",
              name: "Go Model 1",
              cost: { input: 1, output: 1 },
              limit: { context: 200_000 },
              variants: { balanced: {}, high: {} },
            },
          },
        },
      ],
      connected: ["opencode", "opencode-go"],
      default: { providerID: "opencode", modelID: "free-model" },
    }),
    sessions: [],
    pageMessages: () => ({ items: [] }),
    fileList: (path) =>
      path ? [] : [{ name: "NewProject", path: "NewProject", absolute: directory, type: "directory", ignored: false }],
    findFiles: () => ["NewProject"],
  })
  await page.addInitScript(() => {
    localStorage.setItem("opencode.global.dat:server", JSON.stringify({ projects: { local: [] } }))
    localStorage.setItem(
      "opencode.global.dat:model",
      JSON.stringify({
        user: [
          { providerID: "opencode", modelID: "free-model", visibility: "show" },
          { providerID: "opencode-go", modelID: "go-model-1", visibility: "show" },
        ],
        recent: [{ providerID: "opencode-go", modelID: "go-model-1" }],
        variant: {},
      }),
    )
  })

  await page.goto("/")
  const addProject = page.locator('[data-action="home-add-project-row"]')
  await expectAppVisible(addProject)
  await addProject.click()
  const directoryItem = page.getByRole("treeitem", { name: "NewProject" })
  await expect(directoryItem).toBeVisible()
  await directoryItem.click()
  const selectFolder = page.getByRole("button", { name: "Select folder" })
  await expect(selectFolder).toBeEnabled()
  await selectFolder.click()

  await page.locator('[data-action="home-new-session"]').click()
  await expectAppVisible(page.locator('[data-component="composer"]'))

  const modelControl = page.locator('[data-action="composer-model"]')
  await expect(modelControl).toContainText("Go Model 1")
  await modelControl.click()
  await page.locator('[data-option-key="opencode:free-model"]').click()
  await expect(modelControl).toContainText("Free Model")

  await modelControl.click()
  const goModel = page.locator('[data-option-key="opencode-go:go-model-1"]')
  await expect(goModel).toBeVisible()
  await goModel.click()

  await expect(modelControl).toContainText("Go Model 1")
  const variant = page.getByRole("button", { name: "Choose model variant", exact: true })
  await variant.click()
  await page.getByRole("menuitemradio", { name: "high", exact: true }).click()
  await expect(variant).toContainText("high")

  await modelControl.click()
  await page.locator('[data-option-key="opencode:free-model"]').click()
  await expect(modelControl).toContainText("Free Model")
  await expect(variant).toBeHidden()
  await modelControl.click()
  await goModel.click()
  await expect(modelControl).toContainText("Go Model 1")
  await expect(variant).toContainText("high")
})

test("restores each existing session's model and variant when switching tabs", async ({ page }) => {
  const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
  const sessions = [
    {
      id: "ses_model_selection_a",
      title: "Model selection A",
      model: { id: "model-a", providerID: "opencode", variant: "balanced" },
    },
    {
      id: "ses_model_selection_b",
      title: "Model selection B",
      model: { id: "model-b", providerID: "opencode", variant: "balanced" },
    },
  ]
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_model_selection_flow",
      worktree: directory,
      vcs: "git",
      name: "NewProject",
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "model-a": {
              id: "model-a",
              name: "Model A",
              limit: { context: 200_000 },
              variants: { balanced: {}, high: {} },
            },
            "model-b": {
              id: "model-b",
              name: "Model B",
              limit: { context: 200_000 },
              variants: { balanced: {}, high: {} },
            },
          },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "model-a" },
    },
    sessions: sessions.map((session) => ({
      ...session,
      projectID: "proj_model_selection_flow",
      directory,
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
    })),
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(
    ({ directory, server, sessions }) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify(sessions.map((session) => ({ type: "session", server, sessionId: session.id }))),
      )
    },
    { directory, server, sessions },
  )

  const hrefA = `/server/${base64Encode(server)}/session/${sessions[0].id}`
  const hrefB = `/server/${base64Encode(server)}/session/${sessions[1].id}`
  await page.goto(hrefA)
  await expectSessionReady(page, { server, sessionID: sessions[0].id, title: sessions[0].title })
  const composer = page.locator('[data-component="composer"]')
  await expectAppVisible(composer)
  const modelControl = composer.locator('[data-action="composer-model"]')
  const variant = composer.getByRole("button", { name: "Choose model variant", exact: true })
  await expect(modelControl).toHaveText("Model A")
  await expect(variant).toHaveText("balanced")
  await variant.click()
  await page.getByRole("menuitemradio", { name: "high", exact: true }).click()
  await expect(variant).toHaveText("high")

  await page.locator(`[data-titlebar-tab-link][href="${hrefB}"]`).click()
  await expectSessionReady(page, { server, sessionID: sessions[1].id, title: sessions[1].title })
  await expect(modelControl).toHaveText("Model B")
  await expect(variant).toHaveText("balanced")

  await page.locator(`[data-titlebar-tab-link][href="${hrefA}"]`).click()
  await expectSessionReady(page, { server, sessionID: sessions[0].id, title: sessions[0].title })
  await expect(modelControl).toHaveText("Model A")
  await expect(variant).toHaveText("high")
})
