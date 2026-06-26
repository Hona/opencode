export function decorateLinkFavicons(root: HTMLDivElement) {
  const links = Array.from(root.querySelectorAll("a.external-link"))
  for (const link of links) {
    if (!(link instanceof HTMLAnchorElement)) continue
    if (link.querySelector(':scope > [data-slot="markdown-link-favicon"]')) continue

    const href = link.getAttribute("href")
    if (!href || !/^https?:\/\//i.test(href) || !URL.canParse(href)) continue
    const url = new URL(href)
    if (url.protocol !== "http:" && url.protocol !== "https:") continue

    const slot = document.createElement("span")
    slot.setAttribute("aria-hidden", "true")
    slot.setAttribute("data-slot", "markdown-link-favicon")

    const placeholder = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    placeholder.setAttribute("data-slot", "markdown-link-favicon-placeholder")
    placeholder.setAttribute("viewBox", "0 0 20 20")
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use")
    use.setAttribute("href", "#opencode-icon-link")
    placeholder.appendChild(use)

    const image = document.createElement("img")
    image.alt = ""
    image.decoding = "async"
    image.referrerPolicy = "no-referrer"
    image.addEventListener("load", () => (slot.dataset.loaded = "true"), { once: true })
    image.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=32`

    slot.appendChild(placeholder)
    slot.appendChild(image)
    link.insertAdjacentElement("afterbegin", slot)
  }
}
