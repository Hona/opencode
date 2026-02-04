/**
 * Returns the last segment of a path.
 * Use for display labels from any path string (handles / and \\ separators).
 */
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
 * Use before comparisons, search keys, or shell-facing paths to enforce
 * POSIX separators and stable drive/UNC forms.
 *
 * - Forces '/' separators (C:/foo/bar)
 * - Converts MSYS/Cygwin/WSL roots (/c, /cygdrive/c, /mnt/c) -> C:/
 * - Preserves UNC shares (//server/share)
 */
export function toPosix(p: string) {
  if (!isWin) return p

  const slashed = p.replace(/\\/g, "/")

  // Windows extended-length paths:
  // - Drive: \\\?\\C:\\foo -> //?/C:/foo -> C:/foo
  // - UNC:   \\\?\\UNC\\srv\\sh -> //?/UNC/srv/sh -> //srv/sh
  const extendedUnc = slashed.replace(/^\/\/\?\/UNC\//i, "//")
  const extendedDrive = extendedUnc.replace(/^\/\/\?\/([a-zA-Z]):\//, (_, d) => `${d.toUpperCase()}:/`)

  // MSYS/Cygwin/WSL drive roots
  const msys = extendedDrive.replace(/^\/(?:cygdrive\/|mnt\/)?([a-zA-Z])(?:\/|$)/, (_, d) => `${d.toUpperCase()}:/`)

  // Normalize drive letter casing
  const res = msys.replace(/^([a-z]):\//, (_, d) => `${d.toUpperCase()}:/`)

  // If the path is a UNC share root with a trailing slash, trim it.
  if (/^\/\/[^/]+\/[^/]+\/$/.test(res)) return res.slice(0, -1)
  return res
}

/**
 * Normalize a directory for identity/keys.
 * Use when comparing or memoizing directories; trims trailing slashes
 * but preserves roots like /, //, and C:/.
 */
export function normalizeDirectory(input: string) {
  const normalized = toPosix(input)
  if (!normalized) return normalized
  if (normalized === "/" || normalized === "//" || /^[A-Za-z]:\/$/.test(normalized)) return normalized
  return normalized.replace(/\/+$/, "")
}

/**
 * Returns the parent directory path with a trailing slash.
 * Use for UI display or when you need a path prefix.
 */
export function getDirectory(path: string | undefined) {
  if (!path) return ""
  const trimmed = path.replace(/[\/\\]+$/, "")
  const parts = trimmed.split(/[\/\\]/)
  return parts.slice(0, parts.length - 1).join("/") + "/"
}

/**
 * Returns the file extension without normalization.
 * Use for UI or file type logic; returns "" when no extension.
 */
export function getFileExtension(path: string | undefined) {
  if (!path) return ""
  const parts = path.split(".")
  return parts[parts.length - 1]
}

/**
 * Returns a filename shortened to maxLength, preserving extension.
 * Use for UI labels where space is constrained.
 */
export function getFilenameTruncated(path: string | undefined, maxLength: number = 20) {
  const filename = getFilename(path)
  if (filename.length <= maxLength) return filename
  const lastDot = filename.lastIndexOf(".")
  const ext = lastDot <= 0 ? "" : filename.slice(lastDot)
  const available = maxLength - ext.length - 1 // -1 for ellipsis
  if (available <= 0) return filename.slice(0, maxLength - 1) + "…"
  return filename.slice(0, available) + "…" + ext
}

/**
 * Truncate a string in the middle with an ellipsis.
 * Use for long identifiers where both ends are meaningful.
 */
export function truncateMiddle(text: string, maxLength: number = 20) {
  if (text.length <= maxLength) return text
  const available = maxLength - 1 // -1 for ellipsis
  const start = Math.ceil(available / 2)
  const end = Math.floor(available / 2)
  return text.slice(0, start) + "…" + text.slice(-end)
}
