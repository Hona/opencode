import { fileURLToPath } from "node:url"
import { expect, story } from "../../storybook/playwright/story"

const fixture = `/@fs/${fileURLToPath(new URL("./extension-host.fixture.tsx", import.meta.url)).replaceAll("\\", "/")}`

story("an extension that finishes loading after the host unmounts is never set up", async ({ mount, page }) => {
  // Any story loads the app; the fixture mounts the real host beside it.
  await mount("ui-line-comment--editor")
  const setups = await page.evaluate(async (fixture) => {
    const { mountExtensionHost } = await import(fixture)
    const host = mountExtensionHost()
    host.unmount()
    host.load()
    await new Promise((resolve) => setTimeout(resolve, 100))
    return host.setups()
  }, fixture)
  expect(setups).toBe(0)
})
