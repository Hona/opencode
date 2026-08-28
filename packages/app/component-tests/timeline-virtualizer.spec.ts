import { fileURLToPath } from "node:url"
import { expect, story } from "../../storybook/playwright/story"

const fixture = `/@fs/${fileURLToPath(new URL("./timeline-virtualizer.fixture.tsx", import.meta.url)).replaceAll("\\", "/")}`

story.beforeEach(async ({ mount }) => {
  const component = await mount("opencode-composer-flow--mixed-attachments")
  await expect(component.getByRole("textbox", { name: "Prompt", exact: true })).toHaveText(
    "Review @src/app.tsx with @review and @effect",
  )
})

story("batches only the estimated viewport's cheap suffix before revealing it", async ({ page }) => {
  await page.evaluate(async (fixture) => {
    const { mountTimelineVirtualizer } = await import(fixture)
    mountTimelineVirtualizer({ count: 100, rowHeight: 60, immediate: true })
  }, fixture)
  const root = page.getByTestId("timeline-virtualizer-fixture")
  const content = root.locator("[data-timeline-virtual-content]")
  await expect(root).toHaveAttribute("data-observed-height", "180")
  await expect(content).toHaveCSS("visibility", "hidden")
  await expect(content.locator("[data-timeline-key]")).toHaveCount(4)
  await expect(content.locator('[data-index="96"]')).toHaveCount(1)
  await expect(content.locator('[data-index="99"]')).toHaveCount(1)
  await root.getByRole("button", { name: "Complete Markdown", exact: true }).click()
  await expect(content).toHaveCSS("visibility", "visible")
  await expect(root).toHaveAttribute("data-first-reveal", /.+/)
  const revealed = await root.evaluate((element) => JSON.parse(element.dataset.firstReveal!))
  expect(revealed).toMatchObject({ mountedRows: 4, pendingMarkdown: 0 })
  expect(revealed.geometry).toEqual(
    [96, 97, 98, 99].map((index) => ({ key: `user-message:message-${index}`, clipHeight: 60, measuredHeight: 60 })),
  )
})

story("reveals a cold timeline after reconnect repairs an offset without a scroll event", async ({ page }) => {
  await page.evaluate(async (fixture) => {
    const { mountTimelineVirtualizer } = await import(fixture)
    mountTimelineVirtualizer({ count: 1, rowHeight: 600 })
  }, fixture)
  const root = page.getByTestId("timeline-virtualizer-fixture")
  const content = root.locator("[data-timeline-virtual-content]")
  const viewport = root.locator("[data-scrollable]")
  const row = content.locator("[data-timeline-key]")
  await expect(root).toHaveAttribute("data-observed-height", "180")
  await expect(content).toHaveCSS("visibility", "hidden")
  await expect(row).toHaveCount(1)
  await expect(row).toHaveCSS("height", "600px")
  await expect(root).toHaveAttribute("data-last-scroll-top", "484")
  await expect(viewport).toHaveJSProperty("scrollTop", 484)
  await expect(content.locator('[data-component="markdown"]:not([data-markdown-ready])')).toHaveCount(1)

  await viewport.dispatchEvent("wheel", { deltaY: -1 })
  await expect(root.getByTestId("timeline-controls")).toHaveAttribute("data-pinned", "false")
  await row.evaluate((element) => element.setAttribute("data-fixture-original", ""))
  const resizes = await root.getAttribute("data-viewport-resizes")
  await root.getByRole("button", { name: "Reconnect ready rows", exact: true }).click()
  expect(await root.evaluate((element) => JSON.parse(element.dataset.reconnected!))).toMatchObject({
    mountedRows: 1,
    pendingMarkdown: 0,
    viewportHeight: 180,
    observedHeight: 180,
    scrollTop: 0,
    scrolls: 0,
    visibility: "hidden",
  })

  await expect(content).toHaveCSS("visibility", "visible")
  await expect(root).toHaveAttribute("data-first-reveal", /.+/)
  expect(await root.evaluate((element) => JSON.parse(element.dataset.firstReveal!))).toMatchObject({
    mountedRows: 1,
    pendingMarkdown: 0,
    viewportHeight: 180,
    scrollTop: 0,
    scrolls: 0,
    visibility: "",
    geometry: [{ key: "user-message:message-0", clipHeight: 600, measuredHeight: 600 }],
  })
  await expect(content.locator("[data-fixture-original]")).toHaveCount(1)
  await expect(root).toHaveAttribute("data-scrolls", "0")
  await expect(root).toHaveAttribute("data-viewport-resizes", resizes!)
  await expect(viewport).toHaveJSProperty("scrollTop", 0)
})

story("waits for a nonempty measured range after a zero-height cold reconnect", async ({ page }) => {
  await page.evaluate(async (fixture) => {
    const { mountTimelineVirtualizer } = await import(fixture)
    mountTimelineVirtualizer({ count: 4, rowHeight: 60 })
  }, fixture)
  const root = page.getByTestId("timeline-virtualizer-fixture")
  const content = root.locator("[data-timeline-virtual-content]")
  await expect(root).toHaveAttribute("data-observed-height", "180")
  await expect(content).toHaveCSS("visibility", "hidden")
  await expect(content.locator("[data-timeline-key]")).toHaveCount(1)
  await expect(content.locator('[data-component="markdown"]:not([data-markdown-ready])')).toHaveCount(1)

  await root.getByRole("button", { name: "Hide viewport", exact: true }).click()
  // A real zero-height ResizeObserver delivery must clear TanStack's range first.
  await expect(root).toHaveAttribute("data-observed-height", "0")
  await expect(content.locator("[data-timeline-key]")).toHaveCount(0)
  await expect(root).not.toHaveAttribute("data-first-reveal")
  await root.getByRole("button", { name: "Reconnect ready rows", exact: true }).click()
  expect(await root.evaluate((element) => JSON.parse(element.dataset.reconnected!))).toMatchObject({
    mountedRows: 0,
    viewportHeight: 180,
    observedHeight: 0,
    visibility: "hidden",
  })

  await expect(root).toHaveAttribute("data-observed-height", "180")
  await expect(content).toHaveCSS("visibility", "visible")
  await expect(root).toHaveAttribute("data-first-reveal", /.+/)
  expect(await root.evaluate((element) => JSON.parse(element.dataset.firstReveal!))).toMatchObject({
    mountedRows: 4,
    pendingMarkdown: 0,
    viewportHeight: 180,
    visibility: "",
    geometry: [
      { key: "user-message:message-0", clipHeight: 60, measuredHeight: 60 },
      { key: "user-message:message-1", clipHeight: 60, measuredHeight: 60 },
      { key: "user-message:message-2", clipHeight: 60, measuredHeight: 60 },
      { key: "user-message:message-3", clipHeight: 60, measuredHeight: 60 },
    ],
  })
  await expect(content.locator("[data-timeline-key]")).toHaveCount(4)
  await expect(content).toHaveCSS("height", "304px")
})
