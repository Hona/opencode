import { realpathSync } from "fs"
import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { sql, type SQL, type SQLWrapper } from "drizzle-orm"

const WindowsDrive = /^[A-Za-z]:(?:\/|$)/
const WindowsDriveRoot = /^[A-Za-z]:\/$/
const IsWindows = process.platform === "win32"

function trimTrailingSlashes(value: string) {
  if (value === "/" || WindowsDriveRoot.test(value)) return value
  return value.replace(/\/+$/, "") || (value.startsWith("/") ? "/" : "")
}

function isWindowsPath(value: string) {
  return WindowsDrive.test(value) || value.startsWith("//")
}

function normalize(input: string) {
  const value = IsWindows ? AppFileSystem.windowsPath(input).replaceAll("\\", "/") : input
  if (!value || value === "/") return value
  if (IsWindows && isWindowsPath(value)) return trimTrailingSlashes(path.win32.normalize(value).replaceAll("\\", "/"))
  return trimTrailingSlashes(path.posix.normalize(value))
}

function realWindowsPath(value: string) {
  const native = value.replaceAll("/", "\\")
  try {
    return normalize(realpathSync.native(native))
  } catch {
    const parent = path.win32.dirname(native)
    if (!parent || parent === native) return value
    try {
      return normalize(path.win32.join(realpathSync.native(parent), path.win32.basename(native)))
    } catch {
      return value
    }
  }
}

function columnValue(column: SQLWrapper) {
  if (!IsWindows) return sql<string>`${column}`
  return sql<string>`replace(${column}, ${"\\"}, ${"/"})`
}

function compare(column: SQLWrapper, value: string): SQL {
  if (IsWindows) return sql`lower(${columnValue(column)}) = ${value.toLowerCase()}`
  return sql`${columnValue(column)} = ${value}`
}

function prefix(column: SQLWrapper, value: string): SQL {
  const boundary = `${value}/`
  if (IsWindows) return sql`lower(substr(${columnValue(column)}, 1, ${boundary.length})) = ${boundary.toLowerCase()}`
  return sql`substr(${columnValue(column)}, 1, ${boundary.length}) = ${boundary}`
}

export function toStoragePath(input: string): string
export function toStoragePath(input: string | undefined): string | undefined
export function toStoragePath(input: string | null): string | null
export function toStoragePath(input: null): null
export function toStoragePath(input: undefined): undefined
export function toStoragePath(input: string | null | undefined): string | null | undefined
export function toStoragePath(input: string | null | undefined) {
  if (input === null || input === undefined) return input
  const value = normalize(input)
  if (IsWindows && isWindowsPath(value)) return realWindowsPath(value)
  return value
}

function toQueryPath(input: string) {
  return normalize(input)
}

export function toStorageRelativePath(input: string): string
export function toStorageRelativePath(input: string | undefined): string | undefined
export function toStorageRelativePath(input: string | null): string | null
export function toStorageRelativePath(input: null): null
export function toStorageRelativePath(input: undefined): undefined
export function toStorageRelativePath(input: string | null | undefined): string | null | undefined
export function toStorageRelativePath(input: string | null | undefined) {
  if (input === null || input === undefined) return input
  if (input === "") return ""
  return normalize(input)
}

export function relativePath(from: string, to: string) {
  const root = toStoragePath(from)
  const target = toStoragePath(to)
  const relative =
    IsWindows && (isWindowsPath(root) || isWindowsPath(target))
      ? path.win32.relative(root.replaceAll("/", "\\"), target.replaceAll("/", "\\"))
      : path.posix.relative(root, target)
  return toStorageRelativePath(relative)
}

export function toNativePath(input: string) {
  const value = normalize(input)
  if (!IsWindows || value === "/" || !isWindowsPath(value)) return value
  return value.replaceAll("/", "\\")
}

export function key(input: string) {
  const value = normalize(input)
  return IsWindows ? value.toLowerCase() : value
}

export function absoluteEquals(column: SQLWrapper, input: string) {
  return compare(column, toQueryPath(input))
}

export function relativeEquals(column: SQLWrapper, input: string) {
  return compare(column, toStorageRelativePath(input) ?? "")
}

export function relativeStartsWith(column: SQLWrapper, input: string) {
  return prefix(column, toStorageRelativePath(input) ?? "")
}

export * as PathIdentity from "./path-identity"
