import {
  decodeFilePath,
  getPathSeparator,
  getWorkspaceRelativePath,
  pathEqual,
  pathKey,
  stripFileProtocol,
  stripQueryAndHash,
  unquoteGitPath,
  encodeFilePath,
} from "@opencode-ai/util/path"

export const filePathKey = (input: string) => pathKey(input)

export const filePathEqual = (a: string | undefined, b: string | undefined) => pathEqual(a, b)

export function dedupeFilePaths(paths: readonly string[]) {
  const seen = new Set<string>()
  const out: string[] = []

  for (const path of paths) {
    const key = filePathKey(path)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key || path)
  }

  return out
}

export function createPathHelpers(scope: () => string) {
  const normalize = (input: string) => {
    const root = scope()

    let path = unquoteGitPath(decodeFilePath(stripQueryAndHash(stripFileProtocol(input))))
    path = getWorkspaceRelativePath(path, root)

    if (path.startsWith("./") || path.startsWith(".\\")) {
      path = path.slice(2)
    }

    if (path.startsWith("/") || path.startsWith("\\")) {
      path = path.slice(1)
    }
    return path
  }

  const display = (input: string) => {
    const path = normalize(input)
    if (getPathSeparator(scope()) === "/") return path
    return path.replace(/\//g, "\\")
  }

  const tab = (input: string) => {
    const path = normalize(input)
    return `file://${encodeFilePath(path)}`
  }

  const normalizeTab = (input: string) => {
    if (!input.startsWith("file://")) return input
    return tab(input)
  }

  const pathFromTab = (tabValue: string) => {
    if (!tabValue.startsWith("file://")) return
    return normalize(tabValue)
  }

  const normalizeDir = (input: string) => normalize(input).replace(/[\\/]+$/, "")

  return {
    normalize,
    display,
    tab,
    normalizeTab,
    pathFromTab,
    normalizeDir,
  }
}
