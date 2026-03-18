import type { ChildProcess } from "child_process"
import { Process } from "../util/process"

export async function stop(proc: ChildProcess) {
  if (process.platform !== "win32" || !proc.pid) {
    proc.kill()
    return
  }

  const out = await Process.run(["taskkill", "/pid", String(proc.pid), "/T", "/F"], {
    nothrow: true,
  })

  if (out.code === 0) return
  proc.kill()
}
