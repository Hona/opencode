import * as Native from "./path-identity/native"
import * as Query from "./path-identity/query"
import * as Storage from "./path-identity/storage"

export type StorageAbsolutePath = Storage.AbsolutePath
export type StorageRelativePath = Storage.RelativePath

export const toStoragePath = Storage.absolutePath
export const toStorageRelativePath = Storage.relativePath
export const relativePath = Storage.between
export const toNativePath = Native.absolutePath
export const key = Query.key
export const absoluteEquals = Query.absoluteEquals
export const relativeEquals = Query.relativeEquals
export const relativeStartsWith = Query.relativeStartsWith

export * as PathIdentity from "./path-identity"
