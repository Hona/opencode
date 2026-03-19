import { base64Encode } from "@opencode-ai/util/encode"
import { workspacePathKey } from "@/context/file/path"
import { decode64 } from "@/utils/base64"

const dir = (directory: string) => workspacePathKey(directory)

export function acceptKey(sessionID: string, directory?: string) {
  if (!directory) return sessionID
  return `${base64Encode(dir(directory))}/${sessionID}`
}

export function directoryAcceptKey(directory: string) {
  return `${base64Encode(dir(directory))}/*`
}

function legacyDirectoryAcceptKey(directory: string) {
  return `${base64Encode(directory)}/*`
}

function matches(a: string | undefined, b: string) {
  return !!a && dir(a) === dir(b)
}

function legacySessionAccept(autoAccept: Record<string, boolean>, sessionID: string, directory?: string) {
  if (!directory) return
  for (const [key, value] of Object.entries(autoAccept)) {
    if (!key.endsWith(`/${sessionID}`)) continue
    const idx = key.length - sessionID.length - 1
    if (idx <= 0) continue
    if (!matches(decode64(key.slice(0, idx)), directory)) continue
    return value
  }
}

function legacyDirectoryAccept(autoAccept: Record<string, boolean>, directory: string) {
  for (const [key, value] of Object.entries(autoAccept)) {
    if (!key.endsWith("/*")) continue
    if (!matches(decode64(key.slice(0, -2)), directory)) continue
    return value
  }
}

function accepted(autoAccept: Record<string, boolean>, sessionID: string, directory?: string) {
  const key = acceptKey(sessionID, directory)
  const directoryKey = directory ? directoryAcceptKey(directory) : undefined
  return (
    autoAccept[key] ??
    legacySessionAccept(autoAccept, sessionID, directory) ??
    autoAccept[sessionID] ??
    (directoryKey ? autoAccept[directoryKey] : undefined) ??
    (directory ? legacyDirectoryAccept(autoAccept, directory) : undefined)
  )
}

export function isDirectoryAutoAccepting(autoAccept: Record<string, boolean>, directory: string) {
  const key = directoryAcceptKey(directory)
  return autoAccept[key] ?? legacyDirectoryAccept(autoAccept, directory) ?? false
}

function sessionLineage(session: { id: string; parentID?: string }[], sessionID: string) {
  const parent = session.reduce((acc, item) => {
    if (item.parentID) acc.set(item.id, item.parentID)
    return acc
  }, new Map<string, string>())
  const seen = new Set([sessionID])
  const ids = [sessionID]

  for (const id of ids) {
    const parentID = parent.get(id)
    if (!parentID || seen.has(parentID)) continue
    seen.add(parentID)
    ids.push(parentID)
  }

  return ids
}

export function autoRespondsPermission(
  autoAccept: Record<string, boolean>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string },
  directory?: string,
) {
  const value = sessionLineage(session, permission.sessionID)
    .map((id) => accepted(autoAccept, id, directory))
    .find((item): item is boolean => item !== undefined)
  return value ?? false
}
