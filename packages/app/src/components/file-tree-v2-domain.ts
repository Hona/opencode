import type { Filter } from "./file-tree"

export function effectiveFileTreeOpen(input: {
  path: string
  expanded: boolean
  collapsed?: boolean
  filter?: Pick<Filter, "dirs">
}) {
  if (input.collapsed) return false
  return input.expanded || input.filter?.dirs.has(input.path) === true
}
