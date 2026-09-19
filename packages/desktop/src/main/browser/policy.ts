// URL policy shared by the pane and page. Electron-free so it stays unit-testable under Bun.

export function destinationOrigin(input: string) {
  if (!URL.canParse(input)) return
  const url = new URL(input)
  return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.origin : undefined
}

/** A file URL for this machine: no host, so UNC shares and remote hosts are rejected. */
export function localFileURL(input: string) {
  if (!URL.canParse(input)) return
  const url = new URL(input)
  return url.protocol === "file:" && !url.hostname ? url.href : undefined
}

/**
 * Whether the server behind an endpoint shares this machine's filesystem. Only then may the pane
 * show file:// documents, since the agent driving it already has that server's disk access.
 */
export function localEndpoint(input: string) {
  if (!URL.canParse(input)) return false
  const host = new URL(input).hostname
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]"
}

export function allowedDestination(input: string, options?: { file?: boolean }) {
  return !!destinationOrigin(input) || (!!options?.file && !!localFileURL(input))
}

export function normalizeURL(input: string, options?: { file?: boolean }) {
  const value = input.trim() || "about:blank"
  const local = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value)
  const url =
    value === "about:blank" || /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `${local ? "http" : "https"}://${value}`
  if (url !== "about:blank" && !allowedDestination(url, options))
    throw new Error(
      options?.file
        ? "Only HTTP, HTTPS, local file, and about:blank URLs are supported."
        : "Only HTTP, HTTPS, and about:blank URLs are supported.",
    )
  return url
}
