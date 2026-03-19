import { base64Encode } from "@opencode-ai/util/encode"
import { pathKey } from "@opencode-ai/util/path"
import { decode64 } from "./base64"

function decodeDir(input: string) {
  const value = decode64(input)
  if (!value) return
  if (base64Encode(value) !== input) return
  return value
}

export function sessionDirKey(input: string) {
  const dir = decodeDir(input)
  if (!dir) return input
  return base64Encode(pathKey(dir) || dir)
}

export function sessionKey(dir: string, id?: string) {
  const key = sessionDirKey(dir)
  if (!id) return key
  return `${key}/${id}`
}

export function sessionParts(input: string) {
  const split = input.indexOf("/")
  const dir = split === -1 ? input : input.slice(0, split)
  const id = split === -1 ? undefined : input.slice(split + 1)
  return {
    dir: sessionDirKey(dir),
    directory: decodeDir(dir),
    id,
    key: sessionKey(dir, id),
  }
}
