import { type ChildProcess, spawnSync } from "node:child_process"

// Note: This logic is duplicated from `packages/opencode/src/util/process.ts`.
// `opencode` depends on `@opencode-ai/sdk`, so the SDK cannot import from `opencode`
// without creating a circular dependency. Since the SDK build relies on `tsc` (no bundling),
// this small snippet is duplicated here to avoid publishing a new micro-package.
export function stop(proc: ChildProcess) {
  if (process.platform === "win32" && proc.pid) {
    const out = spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true })
    if (!out.error && out.status === 0) return
  }
  proc.kill()
}
