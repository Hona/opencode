import nodePath from "node:path"

import { toPosix } from "@opencode-ai/util/path"

const isWin = process.platform === "win32"

function normalizeArgs(args: string[]) {
  if (!isWin) return args
  return args.map((x) => toPosix(x))
}

export { toPosix }

export default {
  ...nodePath,

  join: (...args: string[]) => (isWin ? toPosix(nodePath.join(...normalizeArgs(args))) : nodePath.join(...args)),
  resolve: (...args: string[]) =>
    isWin ? toPosix(nodePath.resolve(...normalizeArgs(args))) : nodePath.resolve(...args),
  normalize: (p: string) => (isWin ? toPosix(nodePath.normalize(toPosix(p))) : nodePath.normalize(p)),
  relative: (from: string, to: string) =>
    isWin ? toPosix(nodePath.relative(toPosix(from), toPosix(to))) : nodePath.relative(from, to),

  toPosix,
}
