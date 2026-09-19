import type { FileContent } from "@/runtime/server/types"

export type ArtifactKind = "image" | "svg" | "audio" | "video" | "pdf" | "html" | "markdown" | "text"

const mimes = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["avif", "image/avif"],
  ["bmp", "image/bmp"],
  ["ico", "image/x-icon"],
  ["tif", "image/tiff"],
  ["tiff", "image/tiff"],
  ["heic", "image/heic"],
  ["svg", "image/svg+xml"],
  ["mp3", "audio/mpeg"],
  ["wav", "audio/wav"],
  ["ogg", "audio/ogg"],
  ["m4a", "audio/mp4"],
  ["aac", "audio/aac"],
  ["flac", "audio/flac"],
  ["opus", "audio/ogg"],
  ["mp4", "video/mp4"],
  ["m4v", "video/mp4"],
  ["webm", "video/webm"],
  ["mov", "video/quicktime"],
  ["ogv", "video/ogg"],
  ["pdf", "application/pdf"],
  ["html", "text/html"],
  ["htm", "text/html"],
  ["md", "text/markdown"],
  ["markdown", "text/markdown"],
  ["mdx", "text/markdown"],
])

export function artifactExtension(path: string) {
  const name = path.split(/[\\/]/).pop() ?? ""
  const index = name.lastIndexOf(".")
  if (index <= 0) return ""
  return name.slice(index + 1).toLowerCase()
}

export function artifactMime(path: string) {
  return mimes.get(artifactExtension(path))
}

export function artifactKind(path: string): ArtifactKind {
  const mime = artifactMime(path)
  if (!mime) return "text"
  if (mime === "image/svg+xml") return "svg"
  if (mime === "application/pdf") return "pdf"
  if (mime === "text/html") return "html"
  if (mime === "text/markdown") return "markdown"
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  return "video"
}

/** Kinds whose bytes are kept as base64 so media elements can play them without a text round trip. */
const binaryKinds = new Set<ArtifactKind>(["image", "audio", "video", "pdf"])

/** Text files never contain NUL; a NUL in the first 8 KiB marks an unknown binary. */
function isBinaryBytes(bytes: Uint8Array) {
  const limit = Math.min(bytes.length, 8192)
  for (let index = 0; index < limit; index++) if (bytes[index] === 0) return true
  return false
}

export function bytesToBase64(bytes: Uint8Array) {
  const parts: string[] = []
  for (let index = 0; index < bytes.length; index += 0x8000) {
    parts.push(String.fromCharCode(...bytes.subarray(index, index + 0x8000)))
  }
  return btoa(parts.join(""))
}

export function fileContentFromBytes(path: string, bytes: Uint8Array): FileContent {
  const kind = artifactKind(path)
  const mimeType = artifactMime(path)
  if (binaryKinds.has(kind)) return { type: "binary", content: bytesToBase64(bytes), encoding: "base64", mimeType }
  // Unknown binaries keep no bytes: the viewer only shows a placeholder for them.
  if (kind === "text" && isBinaryBytes(bytes)) return { type: "binary", content: "" }
  return { type: "text", content: new TextDecoder().decode(bytes), mimeType }
}

/** Build a blob URL from loaded content. Callers revoke it when the viewer unmounts. */
export function blobUrlFromContent(content: FileContent) {
  const type = content.mimeType ?? "application/octet-stream"
  if (content.encoding !== "base64") return URL.createObjectURL(new Blob([content.content], { type }))
  const raw = atob(content.content)
  const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0))
  return URL.createObjectURL(new Blob([bytes], { type }))
}

/**
 * Resolve a link found inside a workspace file against that file's directory. The result is a
 * workspace-relative path, or undefined when the link escapes the workspace root.
 */
export function resolveArtifactPath(base: string, href: string) {
  const target = href.replaceAll("\\", "/")
  if (target.startsWith("/")) return undefined
  const segments = [...base.replaceAll("\\", "/").split("/").filter(Boolean)]
  for (const segment of target.split("/")) {
    if (!segment || segment === ".") continue
    if (segment !== "..") {
      segments.push(segment)
      continue
    }
    if (segments.length === 0) return undefined
    segments.pop()
  }
  return segments.join("/")
}
