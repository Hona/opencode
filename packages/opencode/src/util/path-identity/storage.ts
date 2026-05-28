import path from "path"
import { IsWindows, isWindowsPath } from "./core"

export declare const AbsolutePathBrand: unique symbol
export declare const RelativePathBrand: unique symbol

export type AbsolutePath = string & { readonly [AbsolutePathBrand]: "PathIdentity.Storage.AbsolutePath" }
export type RelativePath = string & { readonly [RelativePathBrand]: "PathIdentity.Storage.RelativePath" }

function storagePath(input: string) {
  return IsWindows ? input.replaceAll("\\", "/") : input
}

export function absolutePath(input: string): AbsolutePath
export function absolutePath(input: string | undefined): AbsolutePath | undefined
export function absolutePath(input: string | null): AbsolutePath | null
export function absolutePath(input: null): null
export function absolutePath(input: undefined): undefined
export function absolutePath(input: string | null | undefined): AbsolutePath | null | undefined
export function absolutePath(input: string | null | undefined) {
  if (input === null || input === undefined) return input
  return storagePath(input) as AbsolutePath
}

export function relativePath(input: string): RelativePath
export function relativePath(input: string | undefined): RelativePath | undefined
export function relativePath(input: string | null): RelativePath | null
export function relativePath(input: null): null
export function relativePath(input: undefined): undefined
export function relativePath(input: string | null | undefined): RelativePath | null | undefined
export function relativePath(input: string | null | undefined) {
  if (input === null || input === undefined) return input
  if (input === "") return "" as RelativePath
  return storagePath(input) as RelativePath
}

export function between(from: string, to: string) {
  const root = absolutePath(from)
  const target = absolutePath(to)
  const relative =
    IsWindows && (isWindowsPath(root) || isWindowsPath(target))
      ? path.win32.relative(root.replaceAll("/", "\\"), target.replaceAll("/", "\\"))
      : path.posix.relative(root, target)
  return relativePath(relative)
}
