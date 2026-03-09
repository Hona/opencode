function rootPath(path: string) {
  if (/^[\\/]+$/.test(path)) return path.includes("\\") ? "\\" : "/"

  const drive = path.match(/^([A-Za-z]:)([\\/]+)?$/)
  if (drive) return `${drive[1]}${path.includes("\\") ? "\\" : "/"}`

  const unc = path.match(/^([\\/]{2}[^\\/]+[\\/][^\\/]+)([\\/]+)?$/)
  if (unc) return `${unc[1]}${path.includes("\\") ? "\\" : "/"}`

  return ""
}

function windowsPath(path: string) {
  return /^[A-Za-z]:([\\/]|$)/.test(path) || path.startsWith("\\\\") || path.includes("\\")
}

function normalizePath(path: string, sep: "/" | "\\") {
  if (sep === "\\") return path.replace(/\//g, "\\")
  return path.replace(/\\/g, "/")
}

function matchesPath(path: string, root: string) {
  const win = windowsPath(root)
  const a = win ? path.replace(/\\/g, "/").toLowerCase() : path.replace(/\\/g, "/")
  const b = win ? root.replace(/\\/g, "/").toLowerCase() : root.replace(/\\/g, "/")
  if (a === b) return true
  if (!a.startsWith(b)) return false
  return b.endsWith("/") || a[b.length] === "/"
}

export function getPathSeparator(path: string | undefined) {
  if (!path) return "/"
  return windowsPath(path) ? "\\" : "/"
}

export function getFilename(path: string | undefined) {
  if (!path) return ""
  const root = rootPath(path)
  if (root) return root
  const trimmed = path.replace(/[\/\\]+$/, "")
  const parts = trimmed.split(/[\/\\]/)
  return parts[parts.length - 1] ?? ""
}

export function getDirectory(path: string | undefined) {
  if (!path) return ""
  const root = rootPath(path)
  if (root) return root
  const trimmed = path.replace(/[\/\\]+$/, "")
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
  if (index === -1) return ""
  return path.slice(0, index + 1)
}

export function hasPathDirectory(path: string | undefined) {
  return !!getDirectory(path)
}

export function displayPath(path: string | undefined, opts: { home?: string } = {}) {
  if (!path) return ""

  const sep = getPathSeparator(opts.home || path)
  const full = normalizePath(path, sep)
  const home = opts.home ? normalizePath(opts.home, sep) : ""
  if (!home) return full
  if (!matchesPath(full, home)) return full
  if (full.length === home.length) return "~"

  const root = home.endsWith(sep) ? home : home + sep
  const rest = full.slice(root.length)
  return rest ? `~${sep}${rest}` : "~"
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
