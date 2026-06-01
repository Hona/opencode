import nodePath from "path"

declare const AbsoluteBrand: unique symbol
declare const RelativeBrand: unique symbol

export type AbsolutePath = string & { readonly [AbsoluteBrand]: "PathStorage.AbsolutePath" }
export type RelativePath = string & { readonly [RelativeBrand]: "PathStorage.RelativePath" }
export type Path = AbsolutePath | RelativePath

function storagePath(input: string) {
  if (process.platform !== "win32") return input
  return input.replaceAll("\\", "/")
}

function isAbsolute(input: string) {
  return nodePath.posix.isAbsolute(input) || (process.platform === "win32" && isWindowsStoragePath(input))
}

function isWindowsStoragePath(input: string) {
  return /^[A-Za-z]:\//.test(input) || input.startsWith("//")
}

export function absolute(input: string): AbsolutePath {
  const result = storagePath(input)
  if (!isAbsolute(result)) throw new Error(`Path is not absolute: ${input}`)
  return result as AbsolutePath
}

export function relative(input: string): RelativePath {
  const result = storagePath(input)
  if (isAbsolute(result)) throw new Error(`Path is not relative: ${input}`)
  return result as RelativePath
}

export function path(input: string): Path {
  const result = storagePath(input)
  return isAbsolute(result) ? (result as AbsolutePath) : (result as RelativePath)
}

export function toPlatform(input: AbsolutePath) {
  if (process.platform !== "win32" || !isWindowsStoragePath(input)) return input
  return input.replaceAll("/", "\\")
}
