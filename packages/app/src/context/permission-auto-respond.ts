import { base64Encode } from "@opencode-ai/core/util/encode"

export function acceptKey(sessionID: string, directory?: string) {
  if (!directory) return sessionID
  return `${base64Encode(directory)}/${sessionID}`
}

export function directoryAcceptKey(directory: string) {
  return `${base64Encode(directory)}/*`
}

function directoryAutoAccept(
  autoAccept: Record<string, boolean>,
  directory: string,
  options: { permissionAllowAll?: boolean; persistedReady?: boolean },
) {
  return (
    autoAccept[directoryAcceptKey(directory)] ??
    (options.persistedReady !== false && options.permissionAllowAll ? true : undefined)
  )
}

function accepted(
  autoAccept: Record<string, boolean>,
  sessionID: string,
  directory?: string,
  options: { permissionAllowAll?: boolean; persistedReady?: boolean } = {},
) {
  const key = acceptKey(sessionID, directory)
  return (
    autoAccept[key] ??
    autoAccept[sessionID] ??
    (directory ? directoryAutoAccept(autoAccept, directory, options) : undefined)
  )
}

export function isDirectoryAutoAccepting(
  autoAccept: Record<string, boolean>,
  directory: string,
  options: { permissionAllowAll?: boolean; persistedReady?: boolean } = {},
) {
  return directoryAutoAccept(autoAccept, directory, options) ?? false
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
  options: { permissionAllowAll?: boolean; persistedReady?: boolean } = {},
) {
  const value = sessionLineage(session, permission.sessionID)
    .map((id) => accepted(autoAccept, id, directory, options))
    .find((item): item is boolean => item !== undefined)
  return value ?? false
}
