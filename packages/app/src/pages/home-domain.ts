export function effectiveHomeSelection<T extends string>(
  selection: { server: T; directory?: string },
  available: readonly T[],
  active: T,
) {
  if (available.includes(selection.server)) return selection
  const server = available.includes(active) ? active : (available[0] ?? active)
  if (server === selection.server) return selection
  return { server }
}

export function homeSearchActiveKey(active: string, results: readonly string[]) {
  if (results.length === 0) return ""
  return results.includes(active) ? active : results[0]
}
