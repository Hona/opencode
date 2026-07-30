import { fileURLToPath } from "node:url"

type ExternalTarget = { type: "url"; value: string } | { type: "path"; value: string }

export function resolveExternalTarget(value: string): ExternalTarget | undefined {
  if (!URL.canParse(value)) return undefined
  const url = new URL(value)
  if (url.protocol === "http:" || url.protocol === "https:") return { type: "url", value: url.href }
  if (url.protocol !== "file:" || (url.hostname && url.hostname !== "localhost")) return undefined

  try {
    return { type: "path", value: fileURLToPath(url) }
  } catch {
    return undefined
  }
}
