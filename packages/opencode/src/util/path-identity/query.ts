import { sql, type SQL, type SQLWrapper } from "drizzle-orm"
import { IsWindows, normalize } from "./core"
import type * as Storage from "./storage"

declare const AbsolutePathBrand: unique symbol
declare const RelativePathBrand: unique symbol

type AbsolutePath = string & { readonly [AbsolutePathBrand]: "PathIdentity.Query.AbsolutePath" }
type RelativePath = string & { readonly [RelativePathBrand]: "PathIdentity.Query.RelativePath" }
type InputPath = string & {
  readonly [Storage.AbsolutePathBrand]?: never
  readonly [Storage.RelativePathBrand]?: never
}

type Expect<T extends true> = T
type _PlainStringAllowed = Expect<string extends InputPath ? true : false>
type _StorageAbsoluteRejected = Expect<Storage.AbsolutePath extends InputPath ? false : true>
type _StorageRelativeRejected = Expect<Storage.RelativePath extends InputPath ? false : true>

function absolutePath(input: string): AbsolutePath {
  return normalize(input) as AbsolutePath
}

function relativePath(input: string): RelativePath {
  if (input === "") return "" as RelativePath
  return normalize(input) as RelativePath
}

function columnValue(column: SQLWrapper) {
  if (!IsWindows) return sql<string>`${column}`
  return sql<string>`replace(${column}, ${"\\"}, ${"/"})`
}

function compare(column: SQLWrapper, value: AbsolutePath | RelativePath): SQL {
  if (IsWindows) return sql`lower(${columnValue(column)}) = ${value.toLowerCase()}`
  return sql`${columnValue(column)} = ${value}`
}

function prefix(column: SQLWrapper, value: RelativePath): SQL {
  const boundary = `${value}/`
  if (IsWindows) return sql`lower(substr(${columnValue(column)}, 1, ${boundary.length})) = ${boundary.toLowerCase()}`
  return sql`substr(${columnValue(column)}, 1, ${boundary.length}) = ${boundary}`
}

export function key(input: string) {
  const value = normalize(input)
  return IsWindows ? value.toLowerCase() : value
}

export function absoluteEquals(column: SQLWrapper, input: InputPath) {
  return compare(column, absolutePath(input))
}

export function relativeEquals(column: SQLWrapper, input: InputPath) {
  return compare(column, relativePath(input))
}

export function relativeStartsWith(column: SQLWrapper, input: InputPath) {
  return prefix(column, relativePath(input))
}
