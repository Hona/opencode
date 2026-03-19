import { Path } from "@/path/path"

type Opts = {
  cwd?: string
  remote?: boolean
}

export function cwd(input?: string) {
  return input ?? process.env.PWD ?? process.cwd()
}

export function dir(input: string, opts: Opts = {}) {
  if (!opts.remote) return Path.pretty(input, { cwd: cwd(opts.cwd) })
  const pf = Path.guess(input)
  if (!pf) return input
  return Path.pretty(input, { platform: pf })
}
