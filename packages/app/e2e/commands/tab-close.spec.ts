import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { modKey } from "../utils"

test("mod+w closes the active file tab", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.locator(promptSelector).click()
  await page.keyboard.type("/open")
  const command = page.locator('[data-slash-id="file.open"]').first()
  await expect(command).toBeVisible()
  await command.hover()
  await page.keyboard.press("Enter")

  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.getByPlaceholder(/search files/i) })
    .first()
  await expect(dialog).toBeVisible()

  await dialog.getByRole("textbox").first().fill("package.json")

  const items = dialog.locator('[data-slot="list-item"][data-key^="file:"]')
  let i = -1
  await expect
    .poll(
      async () => {
        const keys = await items.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-key") ?? ""))
        i = keys.findIndex((key) => /packages[\\/]+app[\\/]+package\.json$/i.test(key.replace(/^file:/, "")))
        return i >= 0
      },
      { timeout: 30_000 },
    )
    .toBe(true)

  const item = items.nth(i)
  await expect(item).toBeVisible()
  await item.click()
  await expect(dialog).toHaveCount(0)

  const tab = page.getByRole("tab", { name: "package.json" }).first()
  await expect(tab).toBeVisible()
  await tab.click()
  await expect(tab).toHaveAttribute("aria-selected", "true")

  await page.keyboard.press(`${modKey}+W`)
  await expect(page.getByRole("tab", { name: "package.json" })).toHaveCount(0)
})
