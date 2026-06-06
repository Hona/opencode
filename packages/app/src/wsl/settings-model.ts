import type { WslOpencodeCheck, WslServerRuntime } from "./types"

export function wslRuntimePresentation(runtime: WslServerRuntime) {
  if (runtime.kind === "ready") return { label: "Running", retryable: false }
  if (runtime.kind === "starting") return { label: "Starting", retryable: false }
  if (runtime.kind === "failed") return { label: "Failed", retryable: true }
  return { label: "Stopped", retryable: true }
}

export function wslOpencodeAction(check?: WslOpencodeCheck) {
  if (!check) return
  if (!check.resolvedPath) return "Install OpenCode"
  if (check.matchesDesktop === false) return "Update OpenCode"
}
