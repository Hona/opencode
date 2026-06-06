export function wslServerIdsToStartOnInitialize(servers: { id: string }[]) {
  return servers.map((server) => server.id)
}

export function expectOpencodeVersion(installed: string | null, expected: string, distro = "Debian") {
  if (installed === expected) return
  throw new Error(`OpenCode update finished but ${distro} still reports ${installed ?? "no version"}; expected ${expected}`)
}
