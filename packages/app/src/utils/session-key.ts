import { base64Encode } from "@opencode-ai/util/encode"
import { createPathHelpers, workspacePathKey } from "@/context/file/path"
import { decode64 } from "./base64"

function decodeDir(input: string) {
  const value = decode64(input)
  if (!value) return
  if (base64Encode(value) !== input) return
  return value
}

const splitSessionKey = (input: string) => {
  const split = input.indexOf("/")
  if (split === -1) return { dir: input, id: undefined }
  return {
    dir: input.slice(0, split),
    id: input.slice(split + 1),
  }
}

export function sessionDirKey(input: string) {
  const dir = decodeDir(input)
  if (!dir) return input
  return base64Encode(workspacePathKey(dir))
}

export function sessionKey(dir: string, id?: string) {
  const key = sessionDirKey(dir)
  if (!id) return key
  return `${key}/${id}`
}

export function sessionParts(input: string) {
  const { dir, id } = splitSessionKey(input)
  return {
    dir: sessionDirKey(dir),
    directory: decodeDir(dir),
    id,
    key: sessionKey(dir, id),
  }
}

export const normalizeSessionKey = (input: string) => sessionParts(input).key

export function sessionPathHelpers(input: string) {
  const dir = sessionParts(input).directory
  if (!dir) return
  return createPathHelpers(() => dir)
}
