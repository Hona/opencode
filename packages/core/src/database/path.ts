import nodePath from "path"
import { customType } from "drizzle-orm/sqlite-core"
import { AbsolutePath } from "../schema"

declare const StorageAbsoluteBrand: unique symbol
declare const StorageRelativeBrand: unique symbol

type StorageAbsolutePath = string & { readonly [StorageAbsoluteBrand]: "DatabasePath.AbsolutePath" }
type StorageRelativePath = string & { readonly [StorageRelativeBrand]: "DatabasePath.RelativePath" }
type StoragePath = StorageAbsolutePath | StorageRelativePath

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

function absolute(input: string): StorageAbsolutePath {
  const result = storagePath(input)
  if (!isAbsolute(result)) throw new Error(`Path is not absolute: ${input}`)
  return result as StorageAbsolutePath
}

function value(input: string): StoragePath {
  const result = storagePath(input)
  return isAbsolute(result) ? (result as StorageAbsolutePath) : (result as StorageRelativePath)
}

function toPlatform(input: StorageAbsolutePath) {
  if (process.platform !== "win32" || !isWindowsStoragePath(input)) return input
  return input.replaceAll("/", "\\")
}

export const absoluteColumn = customType<{
  data: AbsolutePath
  driverData: string
  driverOutput: string
}>({
  dataType() {
    return "text"
  },
  toDriver(input) {
    return absolute(input)
  },
  fromDriver(input) {
    return AbsolutePath.make(toPlatform(absolute(input)))
  },
})

// Legacy sessions may persist an empty directory. Keep that existing value
// readable while normalizing and validating every real directory.
export const directoryColumn = customType<{
  data: string
  driverData: string
  driverOutput: string
}>({
  dataType() {
    return "text"
  },
  toDriver(input) {
    return input ? absolute(input) : input
  },
  fromDriver(input) {
    return input ? toPlatform(absolute(input)) : input
  },
})

export const pathColumn = customType<{
  data: string
  driverData: string
  driverOutput: string
}>({
  dataType() {
    return "text"
  },
  toDriver(input) {
    return value(input)
  },
  fromDriver(input) {
    return value(input)
  },
})

export const absoluteArrayColumn = customType<{
  data: AbsolutePath[]
  driverData: string
  driverOutput: string
}>({
  dataType() {
    return "text"
  },
  toDriver(input) {
    return JSON.stringify(input.map(absolute))
  },
  fromDriver(input) {
    return (JSON.parse(input) as string[]).map((item) => AbsolutePath.make(toPlatform(absolute(item))))
  },
})

// LIKE patterns are not bound through Drizzle column encoders.
export function pattern(input: string): string {
  return value(input)
}
