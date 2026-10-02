import { fileURLToPath } from "node:url"
import type { Owner } from "solid-js"
import type { Context, Dialogs, Service } from "@opencode/gui-extensions/sdk"
import { expect, story } from "../../storybook/playwright/story"

const fixture = `/@fs/${fileURLToPath(new URL("./extension-host.fixture.tsx", import.meta.url)).replaceAll("\\", "/")}`

/** What the scoped-registration case keeps from inside its extension. */
type Scope = { owner?: Owner | null; end: () => void; ctx?: Context }

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

story("older loads neither set up nor fail over the replacement after reloads", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { mountExtensionHost } = await import(fixture)
    const host = mountExtensionHost()
    const setups: string[] = []
    host.reload()
    host.reload()
    host.load(() => void setups.push("first"), 0)
    host.fail(1, new Error("second"))
    await new Promise((resolve) => setTimeout(resolve, 20))
    host.load(() => void setups.push("third"), 2)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const outcome = { setups, status: host.status() }
    host.unmount()

    return outcome
  }, fixture)

  expect(result).toEqual({ setups: ["third"], status: "active" })
})

story("a dialog service kept from before a reload opens and closes nothing under the replacement", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { mountExtensionHost, Dialogs } = await import(fixture)
    const host = mountExtensionHost()
    const services: Dialogs[] = []
    const setup = (ctx: Context) => void services.push(ctx.use(Dialogs))
    const text = (value: string) => () => Object.assign(document.createElement("p"), { textContent: value })
    const shown = (value: string) => !!document.body.textContent?.includes(value)
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    host.load(setup, 0)
    await wait(20)
    host.reload()
    host.load(setup, 1)
    await wait(20)
    const [stale, fresh] = services
    stale.push(text("stale dialog"))
    fresh.push(text("fresh dialog"))
    await wait(50)
    stale.close()
    await wait(300)
    const outcome = { stale: shown("stale dialog"), fresh: shown("fresh dialog") }
    host.unmount()

    return outcome
  }, fixture)

  expect(result).toEqual({ stale: false, fresh: true })
})

story("a dialog pushed in the same tick as a reload never mounts", async ({ page }) => {
  const shown = await page.evaluate(async (fixture) => {
    const { mountExtensionHost, Dialogs } = await import(fixture)
    const host = mountExtensionHost()
    const services: Dialogs[] = []
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    host.load((ctx: Context) => void services.push(ctx.use(Dialogs)), 0)
    await wait(20)
    services[0].push(() => Object.assign(document.createElement("p"), { textContent: "same tick dialog" }))
    host.reload()
    await wait(300)
    const outcome = !!document.body.textContent?.includes("same tick dialog")
    host.unmount()

    return outcome
  }, fixture)

  expect(shown).toBe(false)
})

story("an extension reloaded while disabled starts when it is enabled again", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { mountExtensionHost } = await import(fixture)
    const host = mountExtensionHost()
    const setups: string[] = []
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    host.load(() => void setups.push("first"), 0)
    await wait(20)
    host.disable()
    await wait(20)
    host.reload()
    const afterReload = host.status()

    // A load the reload started finishes while the extension is still disabled.
    if (host.count() > 1) host.load(() => void setups.push("while disabled"), 1)
    await wait(20)
    host.enable()
    await wait(20)
    host.load(() => void setups.push("enabled"), host.count() - 1)
    await wait(50)
    const outcome = { afterReload, setups, status: host.status() }
    host.unmount()

    return outcome
  }, fixture)

  expect(result).toEqual({ afterReload: "disabled", setups: ["first", "enabled"], status: "active" })
})

story(
  "a registration is withdrawn with the scope that made it, and at once when that scope already ended",
  async ({ page }) => {
    const result = await page.evaluate(async (fixture) => {
      const { mountExtensions, until, createActive, createSignal, getOwner, runWithOwner } = await import(fixture)
      const point = { kind: "point" as const, id: "fixture-scoped" }
      const scope: Scope = { end: () => {} }

      const host = mountExtensions({
        definitions: [
          {
            id: "fixture",
            renderer: async () => ({
              default: (ctx: Context) => {
                const [on, set] = createSignal(true)
                scope.end = () => set(false)
                scope.ctx = ctx
                createActive(on, () => {
                  scope.owner = getOwner()
                  ctx.add(point, "during")
                })
              },
            }),
          },
        ],
      })

      await until(() => host.status("fixture") === "active")
      const during = host.entries(point.id)
      scope.end()
      const ended = host.entries(point.id)
      // A captured owner of a generation that ended, as async work resuming late would hold.
      runWithOwner(scope.owner, () => scope.ctx?.add(point, "late"))
      const late = host.entries(point.id)
      host.unmount()

      return { during, ended, late }
    }, fixture)

    expect(result).toEqual({ during: 1, ended: 0, late: 0 })
  },
)

story("a contribution that throws renders nothing and records the error; the others stay", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { mountExtensions, until, Slot } = await import(fixture)
    const text = (value: string) => () => Object.assign(document.createElement("p"), { textContent: value })

    const host = mountExtensions({
      definitions: [
        {
          id: "fixture",
          renderer: async () => ({
            default: (ctx: Context) => {
              ctx.add(Slot, {
                at: "shell.bottom",
                render: () => {
                  throw new Error("broken contribution")
                },
              })
              ctx.add(Slot, { at: "shell.bottom", render: text("kept") })
            },
          }),
        },
        {
          id: "other",
          renderer: async () => ({
            default: (ctx: Context) => void ctx.add(Slot, { at: "shell.bottom", render: text("other") }),
          }),
        },
      ],
    })

    await until(() => !!host.failure("fixture") && !!host.container.textContent?.includes("other"))
    const failure = host.failure("fixture")

    const outcome = {
      text: host.container.textContent,
      status: [host.status("fixture"), host.status("other")],
      failure: { phase: failure?.phase, named: !!failure?.error.includes("broken contribution") },
    }

    host.unmount()

    return outcome
  }, fixture)

  expect(result).toEqual({
    text: "keptother",
    status: ["active", "active"],
    failure: { phase: "render", named: true },
  })
})

story("an extension that requires a service starts once it is active and restarts with it", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { mountExtensions, until, Service } = await import(fixture)
    const Tree: Service<{ version: number }, "provider.tree"> = Service.define("provider.tree")
    const providerLoad = Promise.withResolvers<void>()
    const log: string[] = []
    const versions = { value: 0 }

    const definitions = [
      {
        id: "provider",
        provides: { tree: Tree },
        renderer: async () => {
          await providerLoad.promise

          return { default: (ctx: Context) => void ctx.provide(Tree, { version: ++versions.value }) }
        },
      },
      {
        id: "consumer",
        requires: { tree: Tree },
        renderer: async () => ({
          default: (ctx: Context & { requires: { tree: { version: number } } }) => {
            const version = ctx.requires.tree.version
            log.push(`setup ${version}`)
            ctx.cleanup(() => void log.push(`cleanup ${version}`))
          },
        }),
      },
    ]

    // Hard contracts gate startup: a consumer whose provider is disabled settles the gate without starting.
    const gated = mountExtensions({ definitions, disabled: ["provider"] })
    await until(() => gated.ready())
    const blocked = { status: gated.status("consumer"), log: [...log] }
    gated.unmount()

    const host = mountExtensions({ definitions })
    await new Promise((resolve) => setTimeout(resolve, 50))
    const waiting = { status: host.status("consumer"), log: [...log] }
    providerLoad.resolve()
    await until(() => host.status("consumer") === "active")
    host.reload("provider")
    await until(() => log.length === 3)
    host.disable(["provider"])
    await until(() => log.length === 4)
    const outcome = { blocked, waiting, log, after: host.status("consumer") }
    host.unmount()

    return outcome
  }, fixture)

  expect(result).toEqual({
    blocked: { status: "loading", log: [] },
    waiting: { status: "loading", log: [] },
    log: ["setup 1", "cleanup 1", "setup 2", "cleanup 2"],
    after: "loading",
  })
})

story("declared app stores load before setup, so setup reads the stored value", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { mountExtensions, until, Schema, Store } = await import(fixture)
    const Prefs = Schema.Struct({ open: Schema.Boolean })
    const seen: unknown[] = []

    const host = mountExtensions({
      stored: { "extension.fixture.prefs": { open: true } },
      definitions: [
        {
          id: "fixture",
          stores: { prefs: Store.app(Prefs, { open: false }) },
          renderer: async () => ({
            default: (ctx: Context & { stores: { prefs: { value: { open: boolean } } } }) =>
              void seen.push(ctx.stores.prefs.value.open),
          }),
        },
      ],
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    const held = { status: host.status("fixture"), seen: [...seen] }
    host.release()
    await until(() => host.status("fixture") === "active")
    const outcome = { held, seen }
    host.unmount()

    return outcome
  }, fixture)

  expect(result).toEqual({ held: { status: "loading", seen: [] }, seen: [true] })
})
