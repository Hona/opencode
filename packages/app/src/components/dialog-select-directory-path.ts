import { getFilename, getPathSeparator } from "@opencode-ai/util/path"

export function normalizePath(input: string) {
  const v = input.replaceAll("\\", "/")
  const squash = (value: string) => {
    let next = value
    while (next.includes("//")) next = next.replaceAll("//", "/")
    return next
  }
  if (v.startsWith("//") && !v.startsWith("///")) return "//" + squash(v.slice(2))
  return squash(v)
}

export function normalizeDriveRoot(input: string) {
  const v = normalizePath(input)
  if (/^[A-Za-z]:$/.test(v)) return v + "/"
  return v
}

export function trimTrailing(input: string) {
  const v = normalizeDriveRoot(input)
  if (v === "/") return v
  if (v === "//") return v
  if (/^[A-Za-z]:\/$/.test(v)) return v
  return v.replace(/\/+$/, "")
}

export function joinPath(base: string | undefined, rel: string) {
  const b = trimTrailing(base ?? "")
  const r = trimTrailing(rel).replace(/^\/+/, "")
  if (!b) return r
  if (!r) return b
  if (b.endsWith("/")) return b + r
  return b + "/" + r
}

export function rootOf(input: string) {
  const v = normalizeDriveRoot(input)
  if (v.startsWith("//")) {
    const parts = v
      .slice(2)
      .replace(/^\/+/, "")
      .split("/")
      .filter(Boolean)
    if (parts.length === 0) return "//"
    if (parts.length === 1) return `//${parts[0]}`
    return `//${parts[0]}/${parts[1]}`
  }
  if (v.startsWith("/")) return "/"
  if (/^[A-Za-z]:\//.test(v)) return v.slice(0, 3)
  return ""
}

export function parentOf(input: string) {
  const v = trimTrailing(input)
  if (v === "/") return v
  if (v === "//") return v
  if (/^[A-Za-z]:\/$/.test(v)) return v

  const root = rootOf(v)
  if (root && v === root) return root

  const i = v.lastIndexOf("/")
  if (i <= 0) return root || "/"
  if (i === 2 && /^[A-Za-z]:/.test(v)) return v.slice(0, 3)

  const next = v.slice(0, i)
  if (root && next.length < root.length) return root
  return next
}

export function modeOf(input: string) {
  const raw = normalizeDriveRoot(input.trim())
  if (!raw) return "relative" as const
  if (raw.startsWith("~")) return "tilde" as const
  if (rootOf(raw)) return "absolute" as const
  return "relative" as const
}

export function tildeOf(absolute: string, home: string) {
  const full = trimTrailing(absolute)
  if (!home) return ""

  const hn = trimTrailing(home)
  const lc = full.toLowerCase()
  const hc = hn.toLowerCase()
  if (lc === hc) return "~"
  if (lc.startsWith(hc + "/")) return "~" + full.slice(hn.length)
  return ""
}

export function displaySeparator(path: string, home: string) {
  if (modeOf(path) === "absolute") return getPathSeparator(path)
  return getPathSeparator(home || path)
}

function nativePath(path: string, home: string) {
  if (displaySeparator(path, home) === "/") return path
  return path.replaceAll("/", "\\")
}

function withTrailing(path: string, sep: string) {
  if (!path) return ""
  if (path.endsWith(sep)) return path
  return path + sep
}

export function searchOf(absolute: string, home: string) {
  const full = trimTrailing(absolute)
  const tilde = tildeOf(full, home)
  const native = nativePath(full, home)
  const shown = tilde ? nativePath(tilde, home) : ""

  return Array.from(
    new Set(
      [
        full,
        withTrailing(full, "/"),
        native,
        withTrailing(native, displaySeparator(native, home)),
        tilde,
        withTrailing(tilde, "/"),
        shown,
        withTrailing(shown, displaySeparator(shown, home)),
        getFilename(full),
      ].filter(Boolean),
    ),
  ).join("\n")
}

export function scopeOf(input: string, start: string | undefined, home: string) {
  const base = start ? trimTrailing(start) : ""
  if (!base) return

  const raw = normalizeDriveRoot(input)
  if (!raw) return { directory: base, path: "" }
  if (raw === "~") return { directory: trimTrailing(home || base), path: "" }
  if (raw.startsWith("~/")) return { directory: trimTrailing(home || base), path: raw.slice(2) }

  const root = rootOf(raw)
  if (!root) return { directory: base, path: raw }
  return {
    directory: trimTrailing(root),
    path: raw.slice(root.length).replace(/^\/+/, ""),
  }
}

export function displayPath(path: string, input: string, home: string) {
  const full = trimTrailing(path)
  const value = modeOf(input) === "absolute" ? full : tildeOf(full, home) || full
  return nativePath(value, home)
}
