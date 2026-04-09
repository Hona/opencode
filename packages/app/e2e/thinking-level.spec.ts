import { test, expect } from "./fixtures"
import { modelVariantCycleSelector } from "./selectors"

test("smoke model variant cycle updates label", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.addStyleTag({
    content: `${modelVariantCycleSelector} { display: inline-block !important; }`,
  })

  const button = page.locator(modelVariantCycleSelector)
  const value = page.locator(`${modelVariantCycleSelector} [data-slot="select-select-trigger-value"]`).first()
  await expect(button).toBeVisible()
  await expect(value).toBeVisible()

  const pick = async (skip: string) => {
    const list = page.locator('[data-slot="select-select-item"]')
    await expect
      .poll(
        async () => {
          if (
            await list
              .first()
              .isVisible()
              .catch(() => false)
          )
            return true
          const clicked = await button
            .click({ timeout: 1500 })
            .then(() => true)
            .catch(() => false)
          if (
            clicked &&
            (await list
              .first()
              .isVisible()
              .catch(() => false))
          )
            return true
          await button.focus().catch(() => undefined)
          await button.press("Enter").catch(() => undefined)
          return list
            .first()
            .isVisible()
            .catch(() => false)
        },
        { timeout: 10_000 },
      )
      .toBe(true)

    const items = (await list.allTextContents()).map((x) => x.trim()).filter(Boolean)
    const next = items.find((x) => x !== skip)
    test.skip(!next, "current model has no alternate variants")
    if (!next) return skip

    const index = items.indexOf(next)
    if (index === -1) throw new Error(`Failed to find thinking level option: ${next}`)

    await expect
      .poll(
        async () => {
          if (((await value.textContent().catch(() => "")) ?? "").trim() === next) return true
          if (
            !(await list
              .first()
              .isVisible()
              .catch(() => false))
          ) {
            await button.click().catch(() => undefined)
          }
          const item = list.nth(index)
          const clicked = await item
            .click({ force: true, timeout: 1500 })
            .then(() => true)
            .catch(() => false)
          if (!clicked) {
            await item.focus().catch(() => undefined)
            await item.press("Enter").catch(() => undefined)
          }
          return ((await value.textContent().catch(() => "")) ?? "").trim() === next
        },
        { timeout: 10_000 },
      )
      .toBe(true)

    await expect(value).toHaveText(next)
    return next
  }

  const before = ((await value.textContent()) ?? "").trim()
  const next = await pick(before)
  await pick(next)
})
