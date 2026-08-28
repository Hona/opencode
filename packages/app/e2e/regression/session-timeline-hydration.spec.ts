import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import { expect, test } from "@playwright/test"
import { fixture } from "../performance/timeline/session-timeline-stress.fixture"
import { installStressSessionTabs, stressSessionHref } from "../performance/timeline/timeline-test-helpers"
import { currentSession, mockOpenCodeServer } from "../utils/mock-server"

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" })

for (const window of ["assistant-only", "mixed"] as const) {
  test(`shows the ${window} latest page while leading-parent hydration is held`, async ({ page }) => {
    const source = {
      ...fixture.sessions[0]!,
      id: `ses_hydration_${window}_source`,
      title: `Hydration ${window} source`,
    }
    const target = { ...source, id: `ses_hydration_${window}_target`, title: `Hydration ${window} target` }
    const heading = `Ready ${window} tail`
    // The first two 20-message pages both start with an assistant. Only page three has its parent.
    const messages = Array.from({ length: 41 }, (_, index): SessionMessageInfo => {
      const id = `msg_hydration_${window}_${String(index).padStart(3, "0")}`
      const created = 1700000000000 + index * 1_000
      if (index === 0 || (window === "mixed" && index === 39)) {
        return { id, type: "user", time: { created }, text: `Hydration ${window} prompt ${index}` }
      }
      return {
        id,
        type: "assistant",
        time: { created, completed: created + 500 },
        model: { id: "claude-opus-4-6", providerID: "opencode" },
        agent: "build",
        cost: 0,
        tokens: { input: 100, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "stop",
        content: [
          {
            type: "text",
            text:
              index === 40
                ? `## ${heading}\n\n| Window | State |\n| --- | --- |\n| ${window} | Ready |\n\n\`\`\`ts\nconst hydrated = true\n\`\`\``
                : `**Hydration ${window} answer ${index}**`,
          },
        ],
      }
    })
    const gates = [21, 1].map((index) => ({
      before: messages[index]!.id,
      parent: messages[index === 21 ? 1 : 0]!.id,
      requested: Promise.withResolvers<void>(),
      release: Promise.withResolvers<void>(),
    }))
    const pages: { before?: string; limit: number; ids: string[] }[] = []
    const events: string[] = []
    await mockOpenCodeServer(page, {
      sessions: [source],
      provider: fixture.provider,
      directory: fixture.directory,
      project: fixture.project,
      beforeMessagesResponse: async (request) => {
        if (request.sessionID !== target.id || !request.before) return
        const gate = gates.find((gate) => gate.before === request.before)
        if (!gate) throw new Error(`Unexpected older-page boundary: ${request.before}`)
        gate.requested.resolve()
        await gate.release.promise
      },
      onMessages: (request) => {
        if (request.sessionID === target.id) events.push(`${request.phase}:${request.before ?? "latest"}`)
      },
      pageMessages: (sessionID, limit, before) => {
        const history: SessionMessageInfo[] =
          sessionID === target.id
            ? messages
            : [{ id: `msg_${source.id}`, type: "user", time: { created: 1700000000000 }, text: source.title }]
        const end = before ? history.findIndex((message) => message.id === before) : history.length
        const start = Math.max(0, end - limit)
        const items = history.slice(start, end)
        if (sessionID === target.id) pages.push({ before, limit, ids: items.map((message) => message.id) })
        return { items, cursor: start > 0 ? history[start]!.id : undefined }
      },
    })
    await page.route(
      (url) => url.pathname === `/api/session/${target.id}`,
      (route) => {
        if (route.request().method() !== "GET") return route.fallback()
        return route.fulfill({
          json: { data: currentSession(target, fixture.directory) },
          headers: { "access-control-allow-origin": "*" },
        })
      },
    )
    // Restoring the destination tab would preload its messages before the session click.
    await installStressSessionTabs(page, { sessionIDs: [source.id] })

    const tail = page.locator(`[data-timeline-part-id="${messages[40]!.id}:text:0"]`)
    const markdown = tail.locator('[data-component="markdown"]')
    const content = page.locator("[data-timeline-virtual-content]", { has: tail })
    const viewport = page.locator(".scroll-view__viewport", { has: tail })
    const orphan = page.locator('[data-timeline-row="AssistantPart"]', {
      has: page.locator(`[data-timeline-part-id="${messages[38]!.id}:text:0"]`),
    })
    const expectReadyTail = async () => {
      await expect(tail).toHaveCount(1)
      await expect(content).toHaveCSS("visibility", "visible")
      await expect(markdown).toHaveAttribute("data-markdown-ready", "")
      await expect(markdown.getByRole("heading", { name: heading, exact: true })).toBeVisible()
      await expect(markdown.getByRole("heading", { name: heading, exact: true })).toBeInViewport({ ratio: 1 })
      await expect(markdown.getByRole("cell", { name: window, exact: true })).toBeVisible()
      await expect(markdown.locator("pre code")).toHaveText("const hydrated = true")
      await expect(markdown.locator("pre")).toBeInViewport({ ratio: 1 })
      await expect(content.locator('[data-component="markdown"]:not([data-markdown-ready])')).toHaveCount(0)
      await expect
        .poll(() =>
          viewport.evaluate((element) => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)),
        )
        .toBeLessThanOrEqual(1)
    }

    try {
      await page.goto(stressSessionHref(source.id))
      await expect(page.locator(`[data-timeline-row="UserMessage"][data-message-id="msg_${source.id}"]`)).toContainText(
        source.title,
      )
      await expect(page.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
      await page.evaluate(
        ({ href, title }) => {
          const link = document.createElement("a")
          link.href = href
          link.textContent = title
          document.body.append(link)
        },
        { href: stressSessionHref(target.id), title: `Open ${target.title}` },
      )
      expect(pages).toEqual([])
      expect(events).toEqual([])

      await page.getByRole("link", { name: `Open ${target.title}`, exact: true }).click()
      await expect(page).toHaveURL(stressSessionHref(target.id))
      await gates[0]!.requested.promise
      expect(pages).toEqual([{ before: undefined, limit: 20, ids: messages.slice(21).map((message) => message.id) }])
      expect(events).toEqual(["start:latest", "end:latest", `start:${gates[0]!.before}`])
      // These assertions must pass before either held response is released.
      await expectReadyTail()
      await expect(orphan).toHaveAttribute("data-message-id", messages[21]!.id)
      if (window === "mixed") {
        const user = page.locator(`[data-timeline-row="UserMessage"][data-message-id="${messages[39]!.id}"]`)
        await expect(user).toContainText("Hydration mixed prompt 39")
        await expect(user).toBeInViewport({ ratio: 1 })
      }
      const original = await tail.evaluateHandle((element) => ({
        part: element,
        markdown: element.querySelector('[data-component="markdown"]'),
        heading: element.querySelector("h2"),
      }))
      const bottom = await tail.evaluate((element) => element.getBoundingClientRect().bottom)

      for (const gate of gates) {
        await gate.requested.promise
        gate.release.resolve()
        // A changed group identity proves the older page reached the projection, not just the network.
        await expect(orphan).toHaveAttribute("data-message-id", gate.parent)
        await expectReadyTail()
        await expect
          .poll(() =>
            tail.evaluate((element, bottom) => Math.abs(element.getBoundingClientRect().bottom - bottom), bottom),
          )
          .toBeLessThanOrEqual(1)
        expect(
          await tail.evaluate(
            (element, original) =>
              element === original.part &&
              element.querySelector('[data-component="markdown"]') === original.markdown &&
              element.querySelector("h2") === original.heading,
            original,
          ),
        ).toBe(true)
      }
      expect(pages).toEqual([
        { before: undefined, limit: 20, ids: messages.slice(21).map((message) => message.id) },
        { before: messages[21]!.id, limit: 20, ids: messages.slice(1, 21).map((message) => message.id) },
        { before: messages[1]!.id, limit: 20, ids: [messages[0]!.id] },
      ])
      expect(events).toEqual([
        "start:latest",
        "end:latest",
        ...gates.flatMap((gate) => [`start:${gate.before}`, `end:${gate.before}`]),
      ])
      const ids = await content
        .locator("[data-timeline-part-id]")
        .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-timeline-part-id")))
      expect(new Set(ids).size).toBe(ids.length)
    } finally {
      gates.forEach((gate) => gate.release.resolve())
    }
  })
}
