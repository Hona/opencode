import { test, expect } from "./fixtures"
import { modelVariantCycleSelector } from "./selectors"

test("smoke model variant cycle updates label", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.addStyleTag({
    content: `${modelVariantCycleSelector} { display: inline-block !important; }`,
  })

  const button = page.locator(modelVariantCycleSelector)
  const exists = (await button.count()) > 0
  test.skip(!exists, "current model has no variants")
  if (!exists) return

  await expect(button).toBeVisible()

  const pick = async (skip: string) => {
    await button.click()

    const list = page.getByRole("option")
    await expect(list.first()).toBeVisible()

    const next = (await list.allTextContents()).map((x) => x.trim()).find((x) => x && x !== skip)
    test.skip(!next, "current model has no alternate variants")
    if (!next) return skip

    await page.getByRole("option", { name: next, exact: true }).click()
    await expect(button).toHaveText(next)
    return next
  }

  const before = (await button.innerText()).trim()
  const next = await pick(before)
  await pick(next)
})
