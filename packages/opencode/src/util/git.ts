import { Telemetry } from "@/telemetry"
import { Process } from "./process"

export interface GitResult {
  exitCode: number
  text(): string
  stdout: Buffer
  stderr: Buffer
}

/**
 * Run a git command.
 *
 * Uses Process helpers with stdin ignored to avoid protocol pipe inheritance
 * issues in embedded/client environments.
 */
export async function git(args: string[], opts: { cwd: string; env?: Record<string, string> }): Promise<GitResult> {
  return Telemetry.withSpan(
    "tool.git.execute",
    {
      "git.command": args[0] ?? "unknown",
      "git.args": args.join(" "),
      "git.cwd": opts.cwd,
    },
    async (span) => {
      return Process.run(["git", ...args], {
        cwd: opts.cwd,
        env: opts.env,
        stdin: "ignore",
        nothrow: true,
      })
        .then((result) => {
          span.setAttribute("git.exit_code", result.code)
          return {
            exitCode: result.code,
            text: () => result.stdout.toString(),
            stdout: result.stdout,
            stderr: result.stderr,
          }
        })
        .catch((error) => {
          span.setAttribute("git.exit_code", 1)
          return {
            exitCode: 1,
            text: () => "",
            stdout: Buffer.alloc(0),
            stderr: Buffer.from(error instanceof Error ? error.message : String(error)),
          }
        })
    },
  )
}
