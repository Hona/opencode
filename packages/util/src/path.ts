export function getFilename(path: string | undefined) {
  if (!path) return ""
  const trimmed = path.replace(/[\/\\]+$/, "")
  const parts = trimmed.split(/[\/\\]/)
  return parts[parts.length - 1] ?? ""
}

const isWin =
  (typeof process !== "undefined" && process.platform === "win32") ||
  (typeof navigator !== "undefined" && /\bWindows\b/i.test(navigator.userAgent))

/**
 * Normalize Windows paths to be Bash/LLM friendly.
 *
 * - Forces '/' separators (C:/foo/bar)
 * - Converts MSYS/Cygwin/WSL roots (/c, /cygdrive/c, /mnt/c) -> C:/
 * - Preserves UNC shares (//server/share)
 */
export function toPosix(p: string) {
  if (!isWin) return p

  const slashed = p.replace(/\\/g, "/")
  const msys = slashed.replace(/^\/(?:cygdrive\/|mnt\/)?([a-zA-Z])(?:\/|$)/, (_, d) => `${d.toUpperCase()}:/`)
  return msys.replace(/^([a-z]):\//, (_, d) => `${d.toUpperCase()}:/`)
}

export function getDirectory(path: string | undefined) {
  if (!path) return ""
  const trimmed = path.replace(/[\/\\]+$/, "")
  const parts = trimmed.split(/[\/\\]/)
  return parts.slice(0, parts.length - 1).join("/") + "/"
}

export function getFileExtension(path: string | undefined) {
  if (!path) return ""
  const parts = path.split(".")
  return parts[parts.length - 1]
}

export function getFilenameTruncated(path: string | undefined, maxLength: number = 20) {
  const filename = getFilename(path)
  if (filename.length <= maxLength) return filename
  const lastDot = filename.lastIndexOf(".")
  const ext = lastDot <= 0 ? "" : filename.slice(lastDot)
  const available = maxLength - ext.length - 1 // -1 for ellipsis
  if (available <= 0) return filename.slice(0, maxLength - 1) + "…"
  return filename.slice(0, available) + "…" + ext
}

export function truncateMiddle(text: string, maxLength: number = 20) {
  if (text.length <= maxLength) return text
  const available = maxLength - 1 // -1 for ellipsis
  const start = Math.ceil(available / 2)
  const end = Math.floor(available / 2)
  return text.slice(0, start) + "…" + text.slice(-end)
}
