import { Path } from "@/path/path"

type Opts = {
  cwd?: string
  remote?: boolean
}

export function cwd(input?: string) {
  return input ?? process.env.PWD ?? process.cwd()
}

export function dir(input: string, opts: Opts = {}) {
  const root = cwd(opts.cwd)
  const next = Path.pretty(input, { cwd: root })
  if (!opts.remote || Path.isAbsolute(input)) return next
  return input
}
