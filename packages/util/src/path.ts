export function getFilename(path: string | undefined) {
  if (!path) return ""
  const trimmed = path.replace(/[\/\\]+$/, "")
  const parts = trimmed.split(/[\/\\]/)
  return parts[parts.length - 1] ?? ""
}

const normalizeSlashes = (path: string) => path.replace(/[\\/]+/g, "/")

const isUncPath = (path: string) => /^[\\/]{2}[^\\/]/.test(path)

const isWindowsDrivePath = (path: string) => /^[A-Za-z]:([\\/]|$)/.test(path)

export function pathKey(path: string) {
  if (!path) return ""

  if (isUncPath(path)) {
    const normalized = normalizeSlashes(path).replace(/^\/+/, "").replace(/\/+$/, "")
    return normalized ? `//${normalized.toLowerCase()}` : "//"
  }

  const normalized = normalizeSlashes(path).replace(/\/+$/, "")

  if (isWindowsDrivePath(path)) {
    const folded = normalized.toLowerCase()
    return /^[a-z]:$/.test(folded) ? `${folded}/` : folded
  }

  if (!normalized && /[\\/]/.test(path)) return "/"
  return normalized
}

export function pathEqual(a: string | undefined, b: string | undefined) {
  if (!a || !b) return a === b
  return pathKey(a) === pathKey(b)
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
