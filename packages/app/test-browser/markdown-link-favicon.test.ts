import { describe, expect, test } from "bun:test"
import { decorateLinkFavicons } from "@opencode-ai/session-ui/markdown-link-favicon"

describe("markdown link favicons", () => {
  test("prepends lazy favicons to web links", () => {
    const root = document.createElement("div")
    root.innerHTML = '<a class="external-link" href="https://docs.example.com/guide">Guide</a>'

    decorateLinkFavicons(root)

    const icon = root.querySelector("img")
    expect(icon?.src).toBe("https://www.google.com/s2/favicons?domain=docs.example.com&sz=32")
    expect(icon?.loading).toBe("lazy")
    expect(icon?.decoding).toBe("async")
    expect(icon?.alt).toBe("")
    expect(root.querySelector("a")?.firstElementChild).toBe(icon)
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

    expect(root.querySelectorAll("img")).toHaveLength(1)
  })
})
