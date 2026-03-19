/**
 * UI/string-oriented path helpers shared across packages.
 *
 * This file normalizes separators, display text, and lightweight comparisons,
 * but it is not the source of truth for filesystem-aware resolution,
 * `file://` parsing, or Windows alias handling. Those semantics live in
 * `packages/opencode/src/path/path.ts`.
 */

export function getFilename(path: string | undefined) {
  if (!path) return ""
  const trimmed = path.replace(/[\/\\]+$/, "")
  const parts = trimmed.split(/[\/\\]/)
  return parts[parts.length - 1] ?? ""
}

const normalizeSlashes = (path: string) => path.replace(/[\\/]+/g, "/")

const isUncPath = (path: string) => /^[\\/]{2}[^\\/]/.test(path)

const isWindowsDrivePath = (path: string) => /^[A-Za-z]:([\\/]|$)/.test(path)

const normalizeDrive = (path: string) => {
  const normalized = normalizePath(path)
  if (/^[A-Za-z]:$/.test(normalized)) return `${normalized}/`
  return normalized
}

const trimDisplay = (path: string) => {
  const separator = getPathSeparator(path)
  return separator === "/" ? path : path.replaceAll("/", "\\")
}

export function normalizeInputPath(path: string) {
  return normalizeDrive(path)
}

export function trimPath(path: string) {
  const normalized = normalizeDrive(path)
  if (normalized === "/" || normalized === "//") return normalized
  if (/^[A-Za-z]:\/$/.test(normalized)) return normalized
  return normalized.replace(/\/+$/, "")
}

export function trimPrettyPath(path: string) {
  const trimmed = trimPath(path)
  if (!trimmed) return ""
  return trimDisplay(trimmed)
}

export function joinPath(base: string | undefined, path: string) {
  if (getPathRoot(path)) return trimPrettyPath(path)

  const root = trimPrettyPath(base ?? "")
  const leaf = trimPath(path).replace(/^\/+/, "")
  if (!root) return trimDisplay(leaf)
  if (!leaf) return root

  const separator = getPathSeparator(root)
  const value = separator === "/" ? leaf : leaf.replaceAll("/", "\\")
  if (root.endsWith(separator)) return root + value
  return `${root}${separator}${value}`
}

const mode = (path: string) => {
  const normalized = normalizeDrive(path.trim())
  if (!normalized) return "relative" as const
  if (normalized.startsWith("~")) return "tilde" as const
  if (getPathRoot(normalized)) return "absolute" as const
  return "relative" as const
}

const fold = (path: string) => {
  const normalized = normalizePath(path)
  if (isWindowsDrivePath(normalized) || isUncPath(normalized)) return normalized.toLowerCase()
  return normalized
}

const native = (path: string, home: string) => {
  if (getPathDisplaySeparator(path, home) === "/") return path
  return path.replaceAll("/", "\\")
}

const trailing = (path: string, home: string) => {
  if (!path) return ""
  const separator = getPathDisplaySeparator(path, home)
  if (path.endsWith(separator)) return path
  return path + separator
}

const resep = (path: string, separator: "/" | "\\", trailing: boolean) => {
  const text = normalizePath(path).replace(/\/+$/, "")
  if (!text) return trailing ? separator : ""
  const value = separator === "/" ? text : text.replaceAll("/", "\\")
  return trailing ? value + separator : value
}

export function normalizePath(path: string) {
  if (!path) return ""
  if (isUncPath(path)) return `//${path.slice(2).replace(/[\\/]+/g, "/")}`
  return normalizeSlashes(path)
}

export function stripFileProtocol(input: string) {
  if (!input.startsWith("file://")) return input
  return input.slice("file://".length)
}

export function stripQueryAndHash(input: string) {
  const hash = input.indexOf("#")
  const query = input.indexOf("?")

  if (hash !== -1 && query !== -1) {
    return input.slice(0, Math.min(hash, query))
  }

  if (hash !== -1) return input.slice(0, hash)
  if (query !== -1) return input.slice(0, query)
  return input
}

export function unquoteGitPath(input: string) {
  if (!input.startsWith('"')) return input
  if (!input.endsWith('"')) return input
  const body = input.slice(1, -1)
  const bytes: number[] = []

  for (let i = 0; i < body.length; i++) {
    const char = body[i]!
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0))
      continue
    }

    const next = body[i + 1]
    if (!next) {
      bytes.push("\\".charCodeAt(0))
      continue
    }

    if (next >= "0" && next <= "7") {
      const chunk = body.slice(i + 1, i + 4)
      const match = chunk.match(/^[0-7]{1,3}/)
      if (!match) {
        bytes.push(next.charCodeAt(0))
        i++
        continue
      }
      bytes.push(parseInt(match[0], 8))
      i += match[0].length
      continue
    }

    const escaped =
      next === "n"
        ? "\n"
        : next === "r"
          ? "\r"
          : next === "t"
            ? "\t"
            : next === "b"
              ? "\b"
              : next === "f"
                ? "\f"
                : next === "v"
                  ? "\v"
                  : next === "\\" || next === '"'
                    ? next
                    : undefined

    bytes.push((escaped ?? next).charCodeAt(0))
    i++
  }

  return new TextDecoder().decode(new Uint8Array(bytes))
}

export function decodeFilePath(input: string) {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

export function resolveWorkspacePath(root: string, path: string) {
  if (!path) return path
  if (getPathRoot(path)) return path
  if (!root) return path

  const base = root.replace(/[\\/]+$/, "")
  if (base) return `${base}${getPathSeparator(root)}${path}`

  const prefix = trimPath(root)
  if (!prefix) return path
  if (prefix.endsWith("/")) return prefix + path
  return `${prefix}/${path}`
}

export function getWorkspaceRelativePath(path: string, root: string) {
  if (!root) return path

  const base = trimPath(root)
  if (!base) return path

  const windows = isWindowsDrivePath(base) || isUncPath(base)
  const canonRoot = windows ? base.replace(/\\/g, "/").toLowerCase() : base.replace(/\\/g, "/")
  const canonPath = windows ? path.replace(/\\/g, "/").toLowerCase() : path.replace(/\\/g, "/")

  if (!canonPath.startsWith(canonRoot)) return path
  if (!canonRoot.endsWith("/")) {
    const next = canonPath[canonRoot.length]
    if (next && next !== "/") return path
  }

  return path.slice(base.length).replace(/^[\\/]+/, "")
}

export function getPathSeparator(path: string | undefined) {
  if (!path) return "/"
  if (path.includes("\\") || isWindowsDrivePath(path) || isUncPath(path)) return "\\"
  return "/"
}

export function getPathRoot(path: string) {
  const normalized = normalizeDrive(path)
  if (normalized.startsWith("//")) {
    const parts = normalized
      .slice(2)
      .replace(/^\/+/, "")
      .split("/")
      .filter(Boolean)
    if (parts.length === 0) return "//"
    if (parts.length === 1) return `//${parts[0]}`
    return `//${parts[0]}/${parts[1]}`
  }
  if (normalized.startsWith("/")) return "/"
  if (/^[A-Za-z]:\//.test(normalized)) return normalized.slice(0, 3)
  return ""
}

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

export function getParentPath(path: string) {
  if (!path) return ""
  const normalized = trimPath(path)
  if (normalized === "/" || normalized === "//") return normalized
  if (/^[A-Za-z]:\/$/.test(normalized)) return normalized

  const root = getPathRoot(normalized)
  if (root && normalized === root) return root

  const idx = normalized.lastIndexOf("/")
  if (idx < 0) return root
  if (idx === 0) return "/"
  if (idx === 2 && /^[A-Za-z]:/.test(normalized)) return normalized.slice(0, 3)

  const parent = normalized.slice(0, idx)
  if (root && parent.length < root.length) return root
  return parent || root || "/"
}

const getTildePath = (path: string, home: string) => {
  const full = trimPath(path)
  const base = trimPath(home)
  if (!base) return ""
  if (fold(full) === fold(base)) return "~"
  if (fold(full).startsWith(fold(base + "/"))) return `~${full.slice(base.length)}`
  return ""
}

export function getPathDisplaySeparator(path: string, home: string) {
  if (mode(path) === "absolute") return getPathSeparator(path)
  return getPathSeparator(home || path)
}

export function getPathDisplay(path: string, input: string, home: string) {
  const full = trimPath(path)
  const value = mode(input) === "absolute" ? full : getTildePath(full, home) || full
  return native(value, home)
}

export function getPathSearchText(path: string, home: string) {
  const full = trimPath(path)
  const tilde = getTildePath(full, home)
  const absolute = native(full, home)
  const shown = tilde ? native(tilde, home) : ""

  return Array.from(
    new Set(
      [
        full,
        trailing(full, home),
        absolute,
        trailing(absolute, home),
        tilde,
        trailing(tilde, home),
        shown,
        trailing(shown, home),
        getFilename(full),
      ].filter(Boolean),
    ),
  ).join("\n")
}

export function getPathScope(input: string, start: string | undefined, home: string) {
  const base = start ? trimPrettyPath(start) : ""
  if (!base) return

  const normalized = normalizeInputPath(input)
  if (!normalized) return { directory: base, path: "" }
  if (normalized === "~") return { directory: trimPrettyPath(home || base), path: "" }
  if (normalized.startsWith("~/")) return { directory: trimPrettyPath(home || base), path: normalized.slice(2) }

  const root = getPathRoot(normalized)
  if (!root) return { directory: base, path: normalized }
  return {
    directory: trimPrettyPath(root),
    path: normalized.slice(root.length).replace(/^\/+/, ""),
  }
}

export function getRelativeDisplayPath(path: string, root?: string) {
  if (!path) return ""
  if (!root) return path
  if (root === "/" || root === "\\") return resep(path, getPathSeparator(root), /[\\/]+$/.test(path))

  const separator = getPathSeparator(root)
  const trailing = /[\\/]+$/.test(path)
  const full = normalizePath(path).replace(/\/+$/, "")
  const base = normalizePath(root).replace(/\/+$/, "")
  if (!base) return resep(path, separator, trailing)
  if (!getPathRoot(full)) return resep(full, separator, trailing)
  if (fold(full) === fold(base)) return trailing ? separator : ""

  const prefix = `${base}/`
  if (!fold(full).startsWith(fold(prefix))) return resep(full, separator, trailing)

  const relative = full.slice(base.length).replace(/^\/+/, "")
  if (!relative) return trailing ? separator : ""

  const value = separator + relative.replaceAll("/", separator)
  return trailing ? value + separator : value
}

export function encodeFilePath(filepath: string): string {
  let normalized = filepath.replace(/\\/g, "/")

  if (/^[A-Za-z]:/.test(normalized)) {
    normalized = "/" + normalized
  }

  return normalized
    .split("/")
    .map((segment, index) => {
      if (index === 1 && /^[A-Za-z]:$/.test(segment)) return segment
      return encodeURIComponent(segment)
    })
    .join("/")
}

export function getDirectory(path: string | undefined) {
  if (!path) return ""
  const trimmed = path.replace(/[\/\\]+$/, "")
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
  if (idx < 0) return ""
  return trimmed.slice(0, idx + 1) || getPathSeparator(path)
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
