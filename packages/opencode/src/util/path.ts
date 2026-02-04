import os from "os"
import nodePath from "node:path"

import { normalizeDirectory as baseNormalizeDirectory, toPosix as baseToPosix } from "@opencode-ai/util/path"

const isWin = process.platform === "win32"

function toPosix(p: string) {
  const res = baseToPosix(p)
  if (!isWin) return res
  // Git Bash/MSYS uses /tmp; map it to the real Windows temp dir.
  if (res === "/tmp") return baseToPosix(os.tmpdir())
  if (res.startsWith("/tmp/")) return baseToPosix(nodePath.join(os.tmpdir(), res.slice("/tmp/".length)))
  return res
}

function normalizeArgs(args: string[]) {
  if (!isWin) return args
  return args.map((x) => toPosix(x))
}

function normalizeDirectory(input: string) {
  return toPosix(baseNormalizeDirectory(input))
}

export { toPosix, normalizeDirectory }

export default {
  ...nodePath,

  join: (...args: string[]) => (isWin ? toPosix(nodePath.join(...normalizeArgs(args))) : nodePath.join(...args)),
  resolve: (...args: string[]) =>
    isWin ? toPosix(nodePath.resolve(...normalizeArgs(args))) : nodePath.resolve(...args),
  normalize: (p: string) => (isWin ? toPosix(nodePath.normalize(toPosix(p))) : nodePath.normalize(p)),
  relative: (from: string, to: string) =>
    isWin ? toPosix(nodePath.relative(toPosix(from), toPosix(to))) : nodePath.relative(from, to),

  toPosix,
  normalizeDirectory,
}
