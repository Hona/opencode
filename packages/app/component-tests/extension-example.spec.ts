import { fileURLToPath } from "node:url"
import type { Command, TitlebarItem } from "@opencode/gui-extensions/sdk"
import { expect, story } from "../../storybook/playwright/story"

const source = (path: string) => `/@fs/${fileURLToPath(new URL(path, import.meta.url)).replaceAll("\\", "/")}`

const modules = {
  fixture: source("./extension-host.fixture.tsx"),
  example: source("../../gui-extensions/src/example/compositions.ts"),
}

story.beforeEach(async ({ mount }) => {
  // Any story loads the app; the fixture mounts the real host beside it.
  await mount("ui-line-comment--editor")
})

// The guide walks through this extension, so its window entry runs in the real host: what it offers before main's
// counter is up, while it is, and after it goes away.
story("the guide's example offers its pill and reset command only while main's counter answers", async ({ page }) => {
  const result = await page.evaluate(async (modules) => {
    const [fixture, example] = await Promise.all([import(modules.fixture), import(modules.example)])
    const [count, setCount] = fixture.createSignal(0)
    const [generation, setGeneration] = fixture.createSignal(0)

    // Main's counter as the window's bridge client gives it, while main provides it.
    const counter = {
      add: async (by: number) => setCount(count() + by),
      reset: async () => void setCount(0),
      state: () => count(),
      on: () => () => undefined,
    }

    const host = fixture.mountExtensions({
      definitions: example.renderer,
      ipc: (token: { id: string }) => (token.id === "example.counter" && generation() > 0 ? counter : undefined),
      generation: () => generation(),
    })

    const commands = (): Command[] => host.list(fixture.Command)
    const pills = (): TitlebarItem[] => host.list(fixture.TitlebarItem)
    const seen = () => ({ commands: commands().map((item) => item.id), pills: pills().map((item) => item.label) })

    host.release()
    await fixture.until(() => host.status("example") === "active")
    const starting = seen()
    const toggle = commands().find((item) => item.id === "toggle")
    setGeneration(1)
    const up = seen()
    pills()[0]?.run?.()
    await fixture.until(() => count() === 1)
    const clicked = seen()
    void toggle?.run()
    const hidden = seen()
    void toggle?.run()
    const shown = seen()
    // Main's counter goes away, e.g. its extension restarts.
    setGeneration(0)
    const gone = seen()
    host.unmount()

    return { starting, up, clicked, hidden, shown, gone }
  }, modules)

  expect(result).toEqual({
    starting: { commands: ["toggle"], pills: [] },
    up: { commands: ["toggle", "reset"], pills: ["0 clicks"] },
    clicked: { commands: ["toggle", "reset"], pills: ["1 click"] },
    hidden: { commands: ["toggle", "reset"], pills: [] },
    shown: { commands: ["toggle", "reset"], pills: ["1 click"] },
    gone: { commands: ["toggle"], pills: [] },
  })
})
