import { describe, expect, test } from "bun:test"
import { decorateLinkFavicons } from "@opencode-ai/session-ui/markdown-link-favicon"

describe("markdown link favicons", () => {
  test("reserves a link placeholder while eagerly loading web favicons", () => {
    const root = document.createElement("div")
    root.innerHTML = '<a class="external-link" href="https://docs.example.com/guide">Guide</a>'

    decorateLinkFavicons(root)

    const slot = root.querySelector<HTMLElement>('[data-slot="markdown-link-favicon"]')
    const placeholder = slot?.querySelector('[data-slot="markdown-link-favicon-placeholder"]')
    const icon = slot?.querySelector("img")
    expect(icon?.src).toBe("https://www.google.com/s2/favicons?domain=docs.example.com&sz=32")
    expect(icon?.hasAttribute("loading")).toBe(false)
    expect(icon?.decoding).toBe("async")
    expect(icon?.alt).toBe("")
    expect(placeholder).toBeInstanceOf(SVGElement)
    expect(slot?.dataset.loaded).toBeUndefined()
    expect(root.querySelector("a")?.firstElementChild).toBe(slot)

    icon?.dispatchEvent(new Event("load"))

    expect(slot?.dataset.loaded).toBe("true")
  })

  test("keeps the placeholder and reserved slot when the favicon fails", () => {
    const root = document.createElement("div")
    root.innerHTML = '<a class="external-link" href="https://example.com">Website</a>'

    decorateLinkFavicons(root)

    const slot = root.querySelector<HTMLElement>('[data-slot="markdown-link-favicon"]')
    const icon = slot?.querySelector("img")
    icon?.dispatchEvent(new Event("error"))

    expect(root.contains(slot ?? null)).toBe(true)
    expect(slot?.dataset.loaded).toBeUndefined()
    expect(slot?.querySelector('[data-slot="markdown-link-favicon-placeholder"]')).toBeInstanceOf(SVGElement)
  })

  test("ignores non-web links and does not duplicate icons", () => {
    const root = document.createElement("div")
    root.innerHTML = [
      '<a class="external-link" href="mailto:hello@example.com">Email</a>',
      '<a class="external-link" href="/docs">Docs</a>',
      '<a class="external-link" href="https://example.com">Website</a>',
    ].join("")

    decorateLinkFavicons(root)
    decorateLinkFavicons(root)

    expect(root.querySelectorAll('[data-slot="markdown-link-favicon"]')).toHaveLength(1)
  })
})
