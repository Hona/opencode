import { release } from "node:os"
import { describeArch } from "@opencode/util/arch"

export function describeOS() {
  const name =
    process.platform === "darwin"
      ? "macOS"
      : process.platform === "win32"
        ? "Windows"
        : process.platform === "linux"
          ? "Linux"
          : process.platform
  return `${name} ${release()} (${describeArch()})`
}

export function describeTerminal() {
  const program = process.env.TERM_PROGRAM || process.env.TERM || "unknown"
  const version = process.env.TERM_PROGRAM_VERSION ? ` ${process.env.TERM_PROGRAM_VERSION}` : ""
  const multiplexer = process.env.TMUX ? " in tmux" : process.env.STY ? " in screen" : ""
  return `${program}${version}${multiplexer}`
}
