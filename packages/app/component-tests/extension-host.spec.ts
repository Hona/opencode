import { fileURLToPath } from "node:url"
import type { Context } from "@opencode/gui-extensions/sdk"
import { expect, story } from "../../storybook/playwright/story"

const fixture = `/@fs/${fileURLToPath(new URL("./extension-host.fixture.tsx", import.meta.url)).replaceAll("\\", "/")}`

story.beforeEach(async ({ mount }) => {
  // Any story loads the app; the fixture mounts the real host beside it.
  await mount("ui-line-comment--editor")
})

story("an extension that finishes loading after the host unmounts is never set up", async ({ page }) => {
  const setups = await page.evaluate(async (fixture) => {
    const { mountExtensionHost } = await import(fixture)
    const host = mountExtensionHost()
    const state = { setups: 0 }
    host.unmount()
    host.load(() => void state.setups++)
    await new Promise((resolve) => setTimeout(resolve, 100))
    return state.setups
  }, fixture)
  expect(setups).toBe(0)
})

story("an async setup that resolves after the host unmounts releases everything it registers", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { mountExtensionHost } = await import(fixture)
    const host = mountExtensionHost()
    const started = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const cleaned: string[] = []
    const point = { kind: "point" as const, id: "fixture-point" }
    host.load(async (ctx: Context) => {
      ctx.add(point, "before")
      started.resolve()
      await resume.promise
      ctx.add(point, "after")
      ctx.cleanup(() => void cleaned.push("registered"))
      return () => void cleaned.push("returned")
    })
    await started.promise
    const before = host.entries(point.id)
    host.unmount()
    resume.resolve()
    await new Promise((resolve) => setTimeout(resolve, 100))
    return { before, after: host.entries(point.id), cleaned }
  }, fixture)
  expect(result).toEqual({ before: 1, after: 0, cleaned: ["registered", "returned"] })
})
