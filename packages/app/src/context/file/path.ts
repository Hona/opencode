import {
  decodeFilePath,
  getPathSeparator,
  getPathRoot,
  getWorkspaceRelativePath,
  pathEqual,
  pathKey,
  stripFileProtocol,
  stripQueryAndHash,
  unquoteGitPath,
  encodeFilePath,
} from "@opencode-ai/util/path"

export type PrettyPath = string
export type WorkspacePath = PrettyPath
export type ReviewPath = PrettyPath
export type FilePath = PrettyPath
export type FileUri = `file://${string}`

export type WorkspaceKey = string & { _brand: "WorkspaceKey" }
export type FilePathKey = string & { _brand: "FilePathKey" }
type LegacyFileTabId = FileUri
export const FILE_TAB_PREFIX = "tab:file:" as const
export type FileTabId = `${typeof FILE_TAB_PREFIX}${string}`
export type SessionTabId = "context" | "review" | FileTabId | FileUri

export const workspacePathKey = (input: WorkspacePath) => (pathKey(input) || input) as WorkspaceKey

export const filePathKey = (input: FilePath) => pathKey(input) as FilePathKey

const legacyTabPath = (input: string) => {
  if (!input.startsWith("file://")) return
  const path = decodeFilePath(stripQueryAndHash(stripFileProtocol(input)))
  if (getPathRoot(path)) return
  if (path.startsWith("/") || path.startsWith("\\")) return
  return path
}

const stripTab = (input: string) => (input.startsWith(FILE_TAB_PREFIX) ? input.slice(FILE_TAB_PREFIX.length) : input)

export const isFileTab = (input: string): input is FileTabId | LegacyFileTabId => {
  if (input.startsWith(FILE_TAB_PREFIX)) return true
  return legacyTabPath(input) !== undefined
}

export const filePathEqual = (a: FilePath | undefined, b: FilePath | undefined) => pathEqual(a, b)

export function dedupeFilePaths(paths: readonly FilePath[]) {
  const seen = new Set<FilePathKey>()
  const out: FilePath[] = []

  for (const path of paths) {
    const key = filePathKey(path)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key || path)
  }

  return out
}

export function createPathHelpers(scope: () => WorkspacePath) {
  const normalize = (input: string): FilePath => {
    const root = scope()

    let path = unquoteGitPath(decodeFilePath(stripQueryAndHash(stripFileProtocol(stripTab(input)))))
    path = getWorkspaceRelativePath(path, root)

    if (path.startsWith("./") || path.startsWith(".\\")) {
      path = path.slice(2)
    }

    if (path.startsWith("/") || path.startsWith("\\")) {
      path = path.slice(1)
    }
    return path
  }

  const display = (input: string): FilePath => {
    const path = normalize(input)
    if (getPathSeparator(scope()) === "/") return path
    return path.replace(/\//g, "\\")
  }

  const tab = (input: FilePath): FileTabId => {
    const path = normalize(input)
    return `${FILE_TAB_PREFIX}${encodeFilePath(path)}`
  }

  const normalizeTab = (input: string) => {
    const path = pathFromTab(input)
    if (!path) return input
    return tab(path)
  }

  const pathFromTab = (tabValue: string) => {
    if (!isFileTab(tabValue)) return
    return normalize(tabValue)
  }

  const normalizeDir = (input: string): FilePath => normalize(input).replace(/[\\/]+$/, "")

  return {
    normalize,
    display,
    tab,
    normalizeTab,
    pathFromTab,
    normalizeDir,
  }
}
