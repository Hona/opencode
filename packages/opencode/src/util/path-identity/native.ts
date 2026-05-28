import { IsWindows, isWindowsPath, normalize } from "./core"

export function absolutePath(input: string) {
  const value = normalize(input)
  if (!IsWindows || value === "/" || !isWindowsPath(value)) return value
  return value.replaceAll("/", "\\")
}
