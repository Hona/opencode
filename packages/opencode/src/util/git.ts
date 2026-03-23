import { $ } from "bun"
import { Flag } from "../flag/flag"
import { Telemetry } from "../telemetry"

export interface GitResult {
  exitCode: number
  text(): string | Promise<string>
  stdout: Buffer | ReadableStream<Uint8Array>
  stderr: Buffer | ReadableStream<Uint8Array>
}

/**
 * Run a git command.
 *
 * Uses Bun's lightweight `$` shell by default.  When the process is running
 * as an ACP client, child processes inherit the parent's stdin pipe which
 * carries protocol data – on Windows this causes git to deadlock.  In that
 * case we fall back to `Bun.spawn` with `stdin: "ignore"`.
 */
export async function git(args: string[], opts: { cwd: string; env?: Record<string, string> }): Promise<GitResult> {
  const cmdLine = `git ${args.join(" ")}`.slice(0, 200)
  
  using span = Telemetry.span("tool.git.execute", {
    "tool.type": "git",
    "process.executable.name": "git",
    "process.command_line": cmdLine,
    "process.working_directory": opts.cwd,
    "git.command": args[0] ?? "unknown",
  })

  if (Flag.OPENCODE_CLIENT === "acp") {
    try {
      const proc = Bun.spawn(["git", ...args], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
      })
      
      span.setAttribute("process.pid", proc.pid)

      // Read output concurrently with exit to avoid pipe buffer deadlock
      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).arrayBuffer(),
        new Response(proc.stderr).arrayBuffer(),
      ])
      const stdoutBuf = Buffer.from(stdout)
      const stderrBuf = Buffer.from(stderr)
      
      span.setAttribute("process.exit_code", exitCode)
      
      return {
        exitCode,
        text: () => stdoutBuf.toString(),
        stdout: stdoutBuf,
        stderr: stderrBuf,
      }
    } catch (error) {
      const stderr = Buffer.from(error instanceof Error ? error.message : String(error))
      span.setAttribute("process.exit_code", 1)
      span.recordException(error instanceof Error ? error : new Error(String(error)))
      return {
        exitCode: 1,
        text: () => "",
        stdout: Buffer.alloc(0),
        stderr,
      }
    }
  }

  const env = opts.env ? { ...process.env, ...opts.env } : undefined
  let cmd = $`git ${args}`.quiet().nothrow().cwd(opts.cwd)
  if (env) cmd = cmd.env(env)
  const result = await cmd
  
  span.setAttribute("process.exit_code", result.exitCode)
  
  return {
    exitCode: result.exitCode,
    text: () => result.text(),
    stdout: result.stdout,
    stderr: result.stderr,
  }
}
