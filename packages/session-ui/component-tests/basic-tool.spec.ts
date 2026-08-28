import { fileURLToPath } from "node:url"
import { expect, story } from "../../storybook/playwright/story"

const fixture = `/@fs/${fileURLToPath(new URL("./basic-tool.fixture.tsx", import.meta.url)).replaceAll("\\", "/")}`

story("does not render completed reasoning until it is opened", async ({ mount, page }) => {
  const storyRoot = await mount("current-session-timeline-rows--streaming-reasoning-and-text")
  await expect(storyRoot.locator('[data-component="session-timeline"]')).toBeVisible()
  const cached = await page.evaluate(async (fixture) => {
    const { mountReasoning, getCachedMarkdown } = await import(fixture)
    mountReasoning()
    return !!getCachedMarkdown("cold-reasoning:0:full")
  }, fixture)
  expect(cached).toBe(false)
  const root = page.getByTestId("reasoning-fixture")
  const trigger = root.locator('[data-slot="collapsible-trigger"]')
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(root.locator('[data-component="markdown"]')).toHaveCount(0)
  await trigger.click()
  await expect(root.getByRole("heading", { name: "Cold reasoning", exact: true })).toBeVisible()
  await expect(root.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await trigger.click()
  await expect(root.getByRole("heading", { name: "Cold reasoning", exact: true })).toBeVisible()
})

for (const knownContent of [false, true]) {
  story(
    `preserves tool disclosure behavior with ${knownContent ? "declared" : "inferred"} content`,
    async ({ mount, page }) => {
      const storyRoot = await mount("current-session-research-agents--agent-research", {
        args: { scenario: "exploration" },
      })
      await expect(
        storyRoot.locator(
          '[data-timeline-part-ids="tool_context_read,tool_context_glob"] [data-slot="collapsible-trigger"]',
        ),
      ).toHaveAttribute("aria-expanded", "false")
      await page.evaluate(
        async ({ fixture, knownContent }) => {
          const { mountBasicTool } = await import(fixture)
          mountBasicTool(knownContent)
        },
        { fixture, knownContent },
      )
      const root = page.getByTestId("basic-tool-fixture")
      const trigger = root.locator('[data-slot="collapsible-trigger"]')
      await expect(trigger).toHaveAttribute("aria-expanded", "false")
      if (knownContent) await expect(root.getByTestId("detail-mounts")).toHaveText("0")
      if (!knownContent) await expect(root.getByTestId("detail-mounts")).not.toHaveText("0")
      await trigger.click()
      await expect(root.getByLabel("Detail choice")).toBeVisible()
      if (knownContent) await expect(root.getByTestId("detail-mounts")).toHaveText("1")
      await root.getByLabel("Detail choice").fill("selected")
      await trigger.click()
      await expect(trigger).toHaveAttribute("aria-expanded", "false")
      await trigger.click()
      await expect(root.getByLabel("Detail choice")).toHaveValue("initial")
      if (knownContent) await expect(root.getByTestId("detail-mounts")).toHaveText("2")
    },
  )
}

story("resolves JSX triggers once and supports structured and function triggers", async ({ mount, page }) => {
  const storyRoot = await mount("current-session-research-agents--agent-research", {
    args: { scenario: "exploration" },
  })
  await expect(
    storyRoot.locator(
      '[data-timeline-part-ids="tool_context_read,tool_context_glob"] [data-slot="collapsible-trigger"]',
    ),
  ).toHaveAttribute("aria-expanded", "false")
  await page.evaluate(async (fixture) => {
    const { mountBasicToolTriggers } = await import(fixture)
    mountBasicToolTriggers()
  }, fixture)

  const root = page.getByTestId("basic-tool-triggers-fixture")
  const trigger = root.locator('[data-slot="collapsible-trigger"]')
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(trigger.getByTestId("jsx-trigger")).toHaveText("Initial title")
  await expect(root.getByTestId("trigger-constructions")).toHaveText("1")

  await root.getByLabel("Trigger label").fill("Updated title")
  await expect(trigger.getByTestId("jsx-trigger")).toHaveText("Updated title")
  await expect(trigger.getByTestId("jsx-trigger")).toHaveAttribute("title", "Updated title")
  await expect(root.getByTestId("trigger-constructions")).toHaveText("1")

  await root.getByRole("button", { name: "Use structured title", exact: true }).click()
  await expect(trigger.getByTestId("jsx-trigger")).toHaveCount(0)
  await expect(trigger.locator('[data-slot="basic-tool-tool-title"] [data-component="text-shimmer"]')).toHaveAttribute(
    "aria-label",
    "Updated title",
  )
  await expect(trigger.locator('[data-slot="basic-tool-tool-subtitle"]')).toHaveText("Tool subtitle")
  await expect(trigger.locator('[data-slot="basic-tool-tool-arg"]')).toHaveText(["path=src"])
  await root.getByLabel("Trigger label").fill("Structured title")
  await expect(trigger.locator('[data-slot="basic-tool-tool-title"] [data-component="text-shimmer"]')).toHaveAttribute(
    "aria-label",
    "Structured title",
  )

  await root.getByRole("button", { name: "Use function trigger", exact: true }).click()
  await expect(trigger.locator('[data-slot="basic-tool-tool-info-structured"]')).toHaveCount(0)
  await expect(trigger).toHaveText("Structured title: closed")
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(trigger).toHaveText("Structured title: open")
  await expect(root.getByText("Tool details", { exact: true })).toBeVisible()
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(trigger).toHaveText("Structured title: closed")
  await expect(root.getByText("Tool details", { exact: true })).toBeHidden()
  await expect(root.getByTestId("trigger-constructions")).toHaveText("1")
})
