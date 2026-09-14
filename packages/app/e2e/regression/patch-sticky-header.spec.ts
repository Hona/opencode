import { expect, test } from "@playwright/test"
import { createTwoFilesPatch } from "diff"
import {
  assistantMessage,
  setupTimeline,
  textPart,
  toolPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

for (const width of [1400, 390]) {
  for (const direction of ["ltr", "rtl"]) {
    test(`patch file headers stay flush while scrolling a Used group at ${width}px in ${direction}`, async ({
      page,
    }, info) => {
      const before = Array.from({ length: 80 }, (_, index) => `export const value${index} = ${index}\n`).join("")
      await setupTimeline(page, {
        messages: [
          userMessage(),
          assistantMessage([
            toolPart(
              "prt_sticky_patch",
              "patch",
              "completed",
              { patchText: "Update two files" },
              {
                metadata: {
                  files: ["src/a.ts", "src/b.ts"].map((file) => ({
                    file,
                    status: "modified",
                    additions: 80,
                    deletions: 80,
                    patch: createTwoFilesPatch(file, file, before, before.replaceAll(" = ", " = 1 + ")),
                  })),
                },
              },
            ),
            textPart("prt_after_patch", "Following explanation.\n\n".repeat(60)),
          ]),
        ],
        reducedMotion: true,
        viewport: { width, height: 900 },
      })
      await page.evaluate((direction) => (document.documentElement.dir = direction), direction)
      await page.getByRole("button", { name: "Used 1 Patch", exact: true }).click()
      const patch = page.locator('[data-component="apply-patch-tool"]')
      const scroller = page.locator('[data-slot="session-timeline-scroll"] .scroll-view__viewport')

      for (const file of ["a", "b"]) {
        const name = new RegExp(`${file}\\.ts`)
        const trigger = patch.getByRole("button", { name })
        const header = patch.getByRole("heading", { name })
        await expect(trigger).toHaveAttribute("aria-expanded", "false")
        await trigger.click()
        await expect(trigger).toHaveAttribute("aria-expanded", "true")
        const content = patch.getByRole("region", { name })
        await expect
          .poll(() => content.evaluate((element) => element.getBoundingClientRect().height))
          .toBeGreaterThan(900)

        // Leave follow-latest mode before positioning the viewport inside this file.
        await scroller.hover()
        await page.mouse.wheel(0, -100)
        await content.evaluate((element) => {
          const viewport = element.closest<HTMLElement>(".scroll-view__viewport")!
          viewport.scrollTop += element.getBoundingClientRect().top - viewport.getBoundingClientRect().top + 160
        })
        await expect
          .poll(() =>
            content.evaluate((element) => {
              const viewport = element.closest<HTMLElement>(".scroll-view__viewport")!
              return element.getBoundingClientRect().top - viewport.getBoundingClientRect().top
            }),
          )
          .toBeLessThan(0)
        await expect
          .poll(() =>
            header.evaluate((element) => {
              const viewport = element.closest<HTMLElement>(".scroll-view__viewport")!
              const title = viewport.querySelector("[data-session-title]")?.firstElementChild
              const top = viewport.getBoundingClientRect().top + (title?.getBoundingClientRect().height ?? 0)
              return Math.abs(element.getBoundingClientRect().top - top)
            }),
          )
          .toBeLessThanOrEqual(1)
        await page.screenshot({ path: info.outputPath(`${file}.png`) })
      }

      await scroller.evaluate((element) => (element.scrollTop = element.scrollHeight))
      await expect(patch.getByRole("heading", { name: /b\.ts/ })).not.toBeInViewport()
    })
  }
}
