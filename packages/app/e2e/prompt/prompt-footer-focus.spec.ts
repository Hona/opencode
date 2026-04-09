import type { Locator, Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { promptAgentSelector, promptModelSelector, promptSelector } from "../selectors"

async function ready(page: Page) {
  const prompt = page.locator(promptSelector)
  await prompt.click()
  await expect(prompt).toBeFocused()
  await prompt.pressSequentially("focus")
  return prompt
}

const text = async (locator: Locator) => ((await locator.textContent()) ?? "").trim()

async function body(prompt: Locator) {
  return prompt.evaluate((el) => (el as HTMLElement).innerText)
}

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

async function openModels(page: Page) {
  const trigger = page.locator(`${promptModelSelector} [data-action="prompt-model"]`).first()
  const items = page.locator('[data-slot="list-item"][data-key*=":"]')
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

test("agent select returns focus to the prompt", async ({ page, gotoSession }) => {
  await gotoSession()

  const prompt = await ready(page)

  const current = await text(page.locator(`${promptAgentSelector} [data-slot="select-select-trigger-value"]`).first())
  const items = await openSelect(
    page,
    page.locator(`${promptAgentSelector} [data-slot="select-select-trigger"]`).first(),
  )
  const list = (await items.allTextContents()).map((item) => item.trim()).filter(Boolean)
  const next = list.find((item) => item !== current)
  test.skip(!next, "only one agent available")
  if (!next) return

  const value = page.locator(`${promptAgentSelector} [data-slot="select-select-trigger-value"]`).first()
  const index = list.indexOf(next)
  if (index === -1) throw new Error(`Failed to find agent option: ${next}`)
  await expect
    .poll(
      async () => {
        if ((await text(value)) === next) return true
        if (
          !(await items
            .first()
            .isVisible()
            .catch(() => false))
        ) {
          await page
            .locator(`${promptAgentSelector} [data-slot="select-select-trigger"]`)
            .first()
            .click()
            .catch(() => undefined)
        }
        const item = items.nth(index)
        const clicked = await item
          .click({ force: true, timeout: 1500 })
          .then(() => true)
          .catch(() => false)
        if (!clicked) {
          await item.focus().catch(() => undefined)
          await item.press("Enter").catch(() => undefined)
        }
        return (await text(value)) === next
      },
      { timeout: 10_000 },
    )
    .toBe(true)

  await expect(value).toHaveText(next)
  await expect(prompt).toBeFocused()
  await prompt.pressSequentially(" agent")
  await expect.poll(() => body(prompt)).toContain("focus agent")
})

test("model select returns focus to the prompt", async ({ page, gotoSession }) => {
  await gotoSession()

  const prompt = await ready(page)

  const current = await text(page.locator(`${promptModelSelector} [data-action="prompt-model"] span`).first())
  const items = await openModels(page)
  const list = await items.evaluateAll((nodes) =>
    nodes.map((node) => ({
      key: node.getAttribute("data-key") ?? "",
      name: (node.querySelector("span")?.textContent ?? "").trim(),
    })),
  )
  const next = list.find((item) => item.key && item.name && item.name !== current)
  test.skip(!next, "only one model available")
  if (!next) return

  const value = page.locator(`${promptModelSelector} [data-action="prompt-model"] span`).first()
  await expect
    .poll(
      async () => {
        if ((await text(value)) === next.name) return true
        const item = page.locator(`[data-slot="list-item"][data-key="${next.key}"]`).first()
        if (!(await item.isVisible().catch(() => false))) {
          await page
            .locator(`${promptModelSelector} [data-action="prompt-model"]`)
            .first()
            .click()
            .catch(() => undefined)
          return false
        }
        const clicked = await item
          .click({ force: true, timeout: 1500 })
          .then(() => true)
          .catch(() => false)
        if (!clicked) {
          await item.focus().catch(() => undefined)
          await item.press("Enter").catch(() => undefined)
        }
        return (await text(value)) === next.name
      },
      { timeout: 10_000 },
    )
    .toBe(true)

  await expect(value).toHaveText(next.name)
  await expect(prompt).toBeFocused()
  await prompt.pressSequentially(" model")
  await expect.poll(() => body(prompt)).toContain("focus model")
})
