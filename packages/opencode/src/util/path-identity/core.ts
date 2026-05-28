import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

const WindowsDrive = /^[A-Za-z]:(?:\/|$)/
const WindowsDriveRoot = /^[A-Za-z]:\/$/

export const IsWindows = process.platform === "win32"

function trimTrailingSlashes(value: string) {
  if (value === "/" || WindowsDriveRoot.test(value)) return value
  return value.replace(/\/+$/, "") || (value.startsWith("/") ? "/" : "")
}

export function isWindowsPath(value: string) {
  return WindowsDrive.test(value) || value.startsWith("//")
}

export function normalize(input: string) {
  const value = IsWindows ? AppFileSystem.windowsPath(input).replaceAll("\\", "/") : input
  if (!value || value === "/") return value
  if (IsWindows && isWindowsPath(value)) return trimTrailingSlashes(path.win32.normalize(value).replaceAll("\\", "/"))
  return trimTrailingSlashes(path.posix.normalize(value))
}
