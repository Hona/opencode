import type { BrowserPaneBounds } from "../preload/types"

export function normalizeBrowserURL(input: string) {
  const value = input.trim()
  if (!value) return "about:blank"
  if (value === "about:blank") return value
  const candidate = /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(:\d+)?(?:\/|$)/i.test(value)
    ? `http://${value}`
    : /^[a-z][a-z\d+.-]*:/i.test(value)
      ? value
      : `https://${value}`
  if (!URL.canParse(candidate)) throw new Error("Enter a valid HTTP or HTTPS URL")
  const url = new URL(candidate)
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "file:") {
    throw new Error("Only HTTP, HTTPS, and file URLs are supported")
  }
  if (url.username || url.password) throw new Error("URLs containing credentials are not supported")
  return url.href
}

export function allowedBrowserURL(input: string) {
  if (input === "about:blank") return true
  if (!URL.canParse(input)) return false
  const url = new URL(input)
  return (
    (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "file:") &&
    !url.username &&
    !url.password
  )
}

export function normalizeBrowserBounds(
  input: BrowserPaneBounds,
  parent: BrowserPaneBounds,
): BrowserPaneBounds | undefined {
  if (![input.x, input.y, input.width, input.height].every(Number.isFinite)) return
  const left = Math.max(0, Math.min(Math.round(input.x), parent.width))
  const top = Math.max(0, Math.min(Math.round(input.y), parent.height))
  const right = Math.max(left, Math.min(Math.round(input.x + input.width), parent.width))
  const bottom = Math.max(top, Math.min(Math.round(input.y + input.height), parent.height))
  if (right === left || bottom === top) return
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function browserBottomMasks(bounds: BrowserPaneBounds) {
  if (bounds.width < 20 || bounds.height < 10) return []
  const segments = [
    { offset: 0, height: 2, width: 6 },
    { offset: 2, height: 2, width: 3 },
    { offset: 4, height: 2, width: 2 },
    { offset: 6, height: 4, width: 1 },
  ]
  return segments.flatMap((segment) => {
    const y = bounds.y + bounds.height - segment.offset - segment.height
    return [
      { x: bounds.x, y, width: segment.width, height: segment.height },
      { x: bounds.x + bounds.width - segment.width, y, width: segment.width, height: segment.height },
    ]
  })
}

export function normalizeBrowserRef(input: string) {
  const value = input.trim()
  return value.startsWith("@") ? value : `@${value}`
}
