import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"

test("smoke @mention inserts file pill token", async ({ page, withProject }) => {
  await withProject(async ({ gotoSession }) => {
    await gotoSession()

    const file = "README.md"
    const filePattern = /README\.md/

    const suggestion = page.getByRole("button", { name: filePattern }).first()

    await expect(async () => {
      await page.locator(promptSelector).click()
      await page.keyboard.press("Control+A")
      await page.keyboard.press("Backspace")
      await page.keyboard.type(`@${file}`)
      await expect(suggestion).toBeVisible({ timeout: 500 })
    }).toPass({ timeout: 10_000 })

    await suggestion.hover()

    await page.keyboard.press("Tab")

    const pill = page.locator(`${promptSelector} [data-type="file"]`).first()
    await expect(pill).toBeVisible()
    await expect(pill).toHaveAttribute("data-path", "README.md")

    await page.keyboard.type(" ok")
    await expect(page.locator(promptSelector)).toContainText("ok")
  })
})
