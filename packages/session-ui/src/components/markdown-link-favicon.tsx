export function decorateLinkFavicons(root: ParentNode) {
  const links = Array.from(root.querySelectorAll("a.external-link"))
  for (const link of links) {
    if (!(link instanceof HTMLAnchorElement)) continue
    if (Array.from(link.children).some((child) => child.getAttribute("data-slot") === "markdown-link-favicon"))
      continue

    const href = link.getAttribute("href")
    if (!href || !/^https?:\/\//i.test(href) || !URL.canParse(href)) continue
    const url = new URL(href)
    if (url.protocol !== "http:" && url.protocol !== "https:") continue

    const icon = document.createElement("img")
    icon.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=32`
    icon.alt = ""
    icon.loading = "lazy"
    icon.decoding = "async"
    icon.referrerPolicy = "no-referrer"
    icon.setAttribute("aria-hidden", "true")
    icon.setAttribute("data-slot", "markdown-link-favicon")
    icon.addEventListener("error", () => icon.remove(), { once: true })
    link.prepend(icon)
  }
}
