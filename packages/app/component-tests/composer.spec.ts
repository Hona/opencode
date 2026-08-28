import { expect, story } from "../../storybook/playwright/story"

story("renders restored mentions once and preserves local selection", async ({ mount, page }) => {
  await page.addInitScript(() => {
    const replace = Element.prototype.replaceChildren
    Element.prototype.replaceChildren = function (this: Element, ...nodes) {
      // The ref can run before data-component is assigned, so count on every target.
      this.setAttribute("data-test-replacements", String(Number(this.getAttribute("data-test-replacements")) + 1))
      return replace.apply(this, nodes)
    }
  })
  const component = await mount("opencode-composer-flow--mixed-attachments")
  const input = component.getByRole("textbox", { name: "Prompt", exact: true })
  await expect(input).toHaveText("Review @src/app.tsx with @review and @effect")
  await expect(input.locator('[data-mention="file"]')).toHaveAttribute("data-path", "src/app.tsx")
  await expect(input.locator('[data-mention="agent"]')).toHaveAttribute("data-name", "review")
  await expect(input.locator('[data-mention="skill"]')).toHaveAttribute("data-id", "effect")
  await expect(input.locator('[contenteditable="false"]')).toHaveCount(3)
  await expect(input).toHaveAttribute("data-test-replacements", "1")

  await input.focus()
  await input.evaluate((element) => {
    const range = document.createRange()
    range.setStart(element.firstChild!, 2)
    range.setEnd(element.firstChild!, 4)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await input.pressSequentially("X")
  await expect(input).toHaveText("ReXew @src/app.tsx with @review and @effect")
  await expect(input).toHaveAttribute("data-test-replacements", "1")
  expect(
    await input.evaluate((element) => {
      const selection = window.getSelection()
      return {
        local: selection?.anchorNode === element.firstChild,
        collapsed: selection?.isCollapsed,
        offset: selection?.anchorOffset,
      }
    }),
  ).toEqual({ local: true, collapsed: true, offset: 3 })
})

story("restores the caret and renders an external draft after local typing", async ({ mount, page }) => {
  const component = await mount("opencode-composer-flow--failed-submission-restoration")
  const input = component.getByRole("textbox", { name: "Prompt", exact: true })
  await expect(input).toHaveText("Preserve this draft on failure")
  // Closing the model picker restores the controller's saved caret through its editor ref.
  await component.locator('[data-action="composer-model"]').click()
  await page.getByRole("menu").getByRole("textbox").press("Escape")
  await expect(input).toBeFocused()
  await input.pressSequentially("!")
  await expect(input).toHaveText("Preserve this draft on failure!")
  await input.fill("Changed draft")
  await component.getByRole("button", { name: "Send", exact: true }).click()
  await expect(component.getByRole("status")).toHaveText("Submission failed; draft restored")
  await expect(input).toHaveText("Preserve this draft on failure")
})

// Moved from packages/app/e2e/regression/prompt-thinking-level.spec.ts
story("shows the thinking level control while relevant", async ({ mount, page }) => {
  const component = await mount("opencode-composer-flow--model-and-variant")
  const composer = component.locator('[data-component="composer"]')
  const input = composer.locator('[data-component="composer-editor"]')
  const control = composer.getByRole("button", { name: "Choose model variant" })

  await page.mouse.move(0, 0)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await expect(control).toBeVisible()

  await control.click()
  const high = page.getByRole("menuitemradio", { name: "high" })
  await expect(high).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(control).toBeVisible()
  await expect(high).toBeVisible()
  await high.click()

  await input.focus()
  await expect(control).toBeVisible()
  await input.blur()
  await expect(control).toBeVisible()
})
