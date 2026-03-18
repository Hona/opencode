import { getPathSeparator } from "@opencode-ai/util/path"

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
  if (v.startsWith("//")) return "//"
  if (v.startsWith("/")) return "/"
  if (/^[A-Za-z]:\//.test(v)) return v.slice(0, 3)
  return ""
}

export function parentOf(input: string) {
  const v = trimTrailing(input)
  if (v === "/") return v
  if (v === "//") return v
  if (/^[A-Za-z]:\/$/.test(v)) return v

  const i = v.lastIndexOf("/")
  if (i <= 0) return "/"
  if (i === 2 && /^[A-Za-z]:/.test(v)) return v.slice(0, 3)
  return v.slice(0, i)
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
  return getPathSeparator(home || path)
}

function nativePath(path: string, home: string) {
  if (displaySeparator(path, home) === "/") return path
  return path.replaceAll("/", "\\")
}

export function displayPath(path: string, input: string, home: string) {
  const full = trimTrailing(path)
  const value = modeOf(input) === "absolute" ? full : tildeOf(full, home) || full
  return nativePath(value, home)
}
