import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"

test("smoke @mention inserts file pill token", async ({ page, withProject }) => {
  await withProject(async ({ gotoSession }) => {
    await gotoSession()

    await page.waitForTimeout(3000)

    await page.locator(promptSelector).click()
    const file = "README.md"
    const filePattern = /README\.md/

    await page.keyboard.type(`@${file}`)

    const suggestion = page.getByRole("button", { name: filePattern }).first()
    await expect(suggestion).toBeVisible()
    await suggestion.hover()

    await page.keyboard.press("Tab")

    const pill = page.locator(`${promptSelector} [data-type="file"]`).first()
    await expect(pill).toBeVisible()
    await expect(pill).toHaveAttribute("data-path", "README.md")

    await page.keyboard.type(" ok")
    await expect(page.locator(promptSelector)).toContainText("ok")
  })
})
