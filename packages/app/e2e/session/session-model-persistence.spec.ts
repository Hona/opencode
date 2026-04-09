import type { Locator, Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { openSidebar, resolveSlug, setWorkspacesEnabled, waitSession, waitSlug } from "../actions"
import {
  promptAgentSelector,
  promptModelSelector,
  promptVariantSelector,
  workspaceItemSelector,
  workspaceNewSessionSelector,
} from "../selectors"
import { modKey, sessionPath } from "../utils"

test.setTimeout(120_000)

type Footer = {
  agent: string
  model: string
  variant: string
}

type Choice = {
  key: string
  footer: Footer
}

const text = async (locator: Locator) => ((await locator.textContent()) ?? "").trim()

async function openSelect(page: Page, trigger: Locator) {
  const items = page.locator('[data-slot="select-select-item"]')
  await expect
    .poll(
      async () => {
        if (
          await items
            .first()
            .isVisible()
            .catch(() => false)
        )
          return true
        const clicked = await trigger
          .click({ timeout: 1500 })
          .then(() => true)
          .catch(() => false)
        if (
          clicked &&
          (await items
            .first()
            .isVisible()
            .catch(() => false))
        )
          return true
        await trigger.focus().catch(() => undefined)
        await trigger.press("Enter").catch(() => undefined)
        return items
          .first()
          .isVisible()
          .catch(() => false)
      },
      { timeout: 10_000 },
    )
    .toBe(true)
  return items
}

async function pickSelect(page: Page, root: string, value: string) {
  const trigger = page.locator(`${root} [data-slot="select-select-trigger"]`).first()
  const label = page.locator(`${root} [data-slot="select-select-trigger-value"]`).first()
  await expect(trigger).toBeVisible()
  const items = await openSelect(page, trigger)
  const list = (await items.allTextContents()).map((item) => item.trim()).filter(Boolean)
  const index = list.indexOf(value)
  if (index === -1) throw new Error(`Failed to find select option: ${value}`)
  await expect
    .poll(
      async () => {
        if ((await text(label)) === value) return true
        if (
          !(await items
            .first()
            .isVisible()
            .catch(() => false))
        ) {
          await openSelect(page, trigger)
        }
        await items
          .first()
          .focus()
          .catch(() => undefined)
        await page.keyboard.press("Home").catch(() => undefined)
        for (const _ of list.slice(0, index)) {
          await page.keyboard.press("ArrowDown").catch(() => undefined)
        }
        await page.keyboard.press("Enter").catch(() => undefined)
        return (await text(label)) === value
      },
      { timeout: 10_000 },
    )
    .toBe(true)
}

async function selectTexts(page: Page, root: string) {
  const items = await openSelect(page, page.locator(`${root} [data-slot="select-select-trigger"]`).first())
  const list = [...new Set((await items.allTextContents()).map((item) => item.trim()).filter(Boolean))]
  await page.keyboard.press("Escape").catch(() => undefined)
  return list
}

async function openModels(page: Page) {
  const trigger = page.locator(`${promptModelSelector} [data-action="prompt-model"]`).first()
  const items = page.locator('[data-slot="list-item"][data-key*=":"]')
  await expect(trigger).toBeVisible()
  await expect
    .poll(
      async () => {
        if (
          await items
            .first()
            .isVisible()
            .catch(() => false)
        )
          return true
        const clicked = await trigger
          .click({ timeout: 1500 })
          .then(() => true)
          .catch(() => false)
        if (
          clicked &&
          (await items
            .first()
            .waitFor({ state: "visible", timeout: 1500 })
            .then(() => true)
            .catch(() => false))
        )
          return true
        await trigger.focus().catch(() => undefined)
        await trigger.press("Enter").catch(() => undefined)
        const entered = await items
          .first()
          .waitFor({ state: "visible", timeout: 1500 })
          .then(() => true)
          .catch(() => false)
        if (entered) return true

        await page.keyboard.press(`${modKey}+'`).catch(() => undefined)
        return items
          .first()
          .waitFor({ state: "visible", timeout: 1500 })
          .then(() => true)
          .catch(() => false)
      },
      { timeout: 10_000 },
    )
    .toBe(true)
  return items
}

async function modelChoices(page: Page) {
  const items = await openModels(page)
  return items.evaluateAll((nodes) =>
    nodes
      .map((node) => ({
        key: node.getAttribute("data-key") ?? "",
        name: (node.querySelector("span")?.textContent ?? "").trim(),
      }))
      .filter((item) => item.key && item.name),
  )
}

async function pickModel(page: Page, input: { key: string; name: string }) {
  const label = page.locator(`${promptModelSelector} [data-action="prompt-model"] span`).first()
  await expect
    .poll(
      async () => {
        if ((await text(label)) === input.name) return true
        await openModels(page)
        const item = page.locator(`[data-slot="list-item"][data-key="${input.key}"]`).first()
        if (!(await item.isVisible().catch(() => false))) return false
        const clicked = await item
          .click({ force: true, timeout: 1500 })
          .then(() => true)
          .catch(() => false)
        if (!clicked) {
          await item.focus().catch(() => undefined)
          await item.press("Enter").catch(() => undefined)
        }
        return (await text(label)) === input.name
      },
      { timeout: 10_000 },
    )
    .toBe(true)
}

async function read(page: Page): Promise<Footer> {
  return {
    agent: await text(page.locator(`${promptAgentSelector} [data-slot="select-select-trigger-value"]`).first()),
    model: await text(page.locator(`${promptModelSelector} [data-action="prompt-model"] span`).first()),
    variant: await text(page.locator(`${promptVariantSelector} [data-slot="select-select-trigger-value"]`).first()),
  }
}

async function waitFooter(page: Page, expected: Partial<Footer>) {
  let hit: Footer | null = null
  await expect
    .poll(
      async () => {
        const state = await read(page)
        const ok = Object.entries(expected).every(([key, value]) => state[key as keyof Footer] === value)
        if (ok) hit = state
        return ok
      },
      { timeout: 30_000 },
    )
    .toBe(true)
  if (!hit) throw new Error("Failed to resolve prompt footer state")
  return hit
}

async function choose(page: Page, root: string, value: string) {
  const select = page.locator(root)
  await expect(select).toBeVisible()
  await pickSelect(page, root, value)
}

async function agents(page: Page) {
  return selectTexts(page, promptAgentSelector)
}

async function variants(page: Page) {
  return selectTexts(page, promptVariantSelector)
}

async function ensureVariant(page: Page): Promise<Footer> {
  const current = await read(page)
  if ((await variants(page)).some((item) => item !== current.variant)) return current

  const names = await agents(page)
  const rest = names.filter((name) => name !== current.agent)
  test.skip(rest.length === 0, "only one agent available")
  if (rest.length === 0) return current

  for (const name of rest) {
    await choose(page, promptAgentSelector, name)
    const next = await waitFooter(page, { agent: name })
    if ((await variants(page)).some((item) => item !== next.variant)) return next
  }

  test.skip(true, "no agent with alternate variants available")
  return current
}

async function chooseDifferentVariant(page: Page): Promise<Footer> {
  const current = await read(page)
  const next = (await variants(page)).find((item) => item !== current.variant)
  if (!next) throw new Error("Current model has no alternate variant to select")

  await pickSelect(page, promptVariantSelector, next)
  return waitFooter(page, { agent: current.agent, model: current.model, variant: next })
}

async function chooseOtherModel(page: Page, skip: string[] = []): Promise<Choice> {
  const current = await read(page)
  const next = (await modelChoices(page)).find(
    (item) => item.key && item.name !== current.model && !skip.includes(item.key),
  )
  if (!next) throw new Error("Failed to choose a different model")
  await pickModel(page, next)
  await expect.poll(async () => (await read(page)).model, { timeout: 30_000 }).toBe(next.name)
  return { key: next.key, footer: await read(page) }
}

async function goto(page: Page, directory: string, serverUrl: string, sessionID?: string) {
  await page.goto(sessionPath(directory, sessionID))
  await waitSession(page, { directory, sessionID, serverUrl })
}

async function submit(project: Parameters<typeof test>[0]["project"], value: string) {
  return project.prompt(value)
}

async function createWorkspace(page: Page, root: string, seen: string[], serverUrl: string) {
  await openSidebar(page)
  await page.getByRole("button", { name: "New workspace" }).first().click()

  const next = await resolveSlug(await waitSlug(page, [root, ...seen]), { serverUrl })
  await waitSession(page, { directory: next.directory, serverUrl })
  return next
}

async function waitWorkspace(page: Page, slug: string) {
  await openSidebar(page)
  await expect
    .poll(
      async () => {
        const item = page.locator(workspaceItemSelector(slug)).first()
        try {
          await item.hover({ timeout: 500 })
          return true
        } catch {
          return false
        }
      },
      { timeout: 60_000 },
    )
    .toBe(true)
}

async function newWorkspaceSession(page: Page, slug: string, serverUrl: string) {
  await waitWorkspace(page, slug)
  const item = page.locator(workspaceItemSelector(slug)).first()
  await item.hover()

  const button = page.locator(workspaceNewSessionSelector(slug)).first()
  await expect(button).toBeVisible()
  await button.click()

  const next = await resolveSlug(await waitSlug(page), { serverUrl })
  return waitSession(page, { directory: next.directory, serverUrl }).then((item) => item.directory)
}

test("session model restore per session without leaking into new sessions", async ({ page, project }) => {
  await page.setViewportSize({ width: 1440, height: 900 })

  await project.open()
  await goto(page, project.directory, project.serverUrl)

  const firstPick = await chooseOtherModel(page)
  const firstState = firstPick.footer
  const firstKey = firstPick.key
  const first = await submit(project, `session variant ${Date.now()}`)

  await page.reload()
  await waitSession(page, { directory: project.directory, sessionID: first, serverUrl: project.serverUrl })
  await waitFooter(page, firstState)

  await goto(page, project.directory, project.serverUrl)
  await expect.poll(async () => (await read(page)).model !== firstState.model, { timeout: 30_000 }).toBe(true)
  const fresh = await read(page)
  expect(fresh.model).not.toBe(firstState.model)

  const secondPick = await chooseOtherModel(page, [firstKey])
  const secondState = secondPick.footer
  const second = await submit(project, `session model ${Date.now()}`)

  await goto(page, project.directory, project.serverUrl, first)
  await waitFooter(page, firstState)

  await goto(page, project.directory, project.serverUrl, second)
  await waitFooter(page, secondState)

  await goto(page, project.directory, project.serverUrl)
  await page.reload()
  await waitSession(page, { directory: project.directory, serverUrl: project.serverUrl })
  await expect
    .poll(
      async () => {
        const state = await read(page)
        return state.model !== firstState.model && state.model !== secondState.model
      },
      { timeout: 30_000 },
    )
    .toBe(true)
})

test("session model restore across workspaces", async ({ page, project }) => {
  await page.setViewportSize({ width: 1440, height: 900 })

  await project.open()
  const root = project.directory
  await goto(page, root, project.serverUrl)

  const firstPick = await chooseOtherModel(page)
  const firstState = firstPick.footer
  const firstKey = firstPick.key
  const first = await submit(project, `root session ${Date.now()}`)

  await openSidebar(page)
  await setWorkspacesEnabled(page, project.slug, true)

  const one = await createWorkspace(page, project.slug, [], project.serverUrl)
  const oneDir = await newWorkspaceSession(page, one.slug, project.serverUrl)
  project.trackDirectory(oneDir)

  const secondPick = await chooseOtherModel(page, [firstKey])
  const secondState = secondPick.footer
  const secondKey = secondPick.key
  const second = await submit(project, `workspace one ${Date.now()}`)

  const two = await createWorkspace(page, project.slug, [one.slug], project.serverUrl)
  const twoDir = await newWorkspaceSession(page, two.slug, project.serverUrl)
  project.trackDirectory(twoDir)

  const thirdPick = await chooseOtherModel(page, [firstKey, secondKey])
  const thirdState = thirdPick.footer
  const third = await submit(project, `workspace two ${Date.now()}`)

  await goto(page, root, project.serverUrl, first)
  await waitFooter(page, firstState)

  await goto(page, oneDir, project.serverUrl, second)
  await waitFooter(page, secondState)

  await goto(page, twoDir, project.serverUrl, third)
  await waitFooter(page, thirdState)

  await goto(page, root, project.serverUrl, first)
  await waitFooter(page, firstState)
})

test("variant preserved when switching agent modes", async ({ page, project }) => {
  await page.setViewportSize({ width: 1440, height: 900 })

  await project.open()
  await goto(page, project.directory, project.serverUrl)

  await ensureVariant(page)
  const updated = await chooseDifferentVariant(page)

  const available = await agents(page)
  const other = available.find((name) => name !== updated.agent)
  test.skip(!other, "only one agent available")
  if (!other) return

  await choose(page, promptAgentSelector, other)
  await waitFooter(page, { agent: other, variant: updated.variant })

  await choose(page, promptAgentSelector, updated.agent)
  await waitFooter(page, { agent: updated.agent, variant: updated.variant })
})
