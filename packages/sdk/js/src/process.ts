import { type ChildProcess } from "node:child_process"
import { once } from "node:events"
import launch from "cross-spawn"

export namespace Process {
  export type Child = ChildProcess & { exited: Promise<void> }

  export type Options = {
    signal?: AbortSignal
    env?: NodeJS.ProcessEnv
    stdio?: "inherit" | "pipe"
  }

  export function spawn(cmd: string, args: string[], opts: Options = {}): Child {
    const proc = launch(cmd, args, {
      signal: opts.signal,
      env: opts.env,
      stdio: opts.stdio,
      windowsHide: process.platform === "win32",
    })
    const exited = once(proc, "exit").then(() => {})
    void exited.catch(() => undefined)

    const child = proc as Child
    child.exited = exited
    return child
  }

  export async function stop(proc: Child) {
    if (proc.exitCode !== null || proc.signalCode !== null) return

    if (process.platform === "win32" && proc.pid) {
      const task = launch("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
        windowsHide: true,
      })
      const code = await new Promise<number>((resolve) => {
        task.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)))
        task.once("error", () => resolve(1))
      })
      if (code === 0) {
        await proc.exited
        return
      }
    }

    proc.kill()
    const done = await new Promise<boolean>((resolve) => {
      const id = setTimeout(() => resolve(false), 5_000)
      void proc.exited.then(
        () => {
          clearTimeout(id)
          resolve(true)
        },
        () => {
          clearTimeout(id)
          resolve(true)
        },
      )
    })
    if (done) return
    if (proc.exitCode !== null || proc.signalCode !== null) return

    proc.kill("SIGKILL")
    await proc.exited
  }
}
