import { Path } from "../../src/path/path"

type Item = {
  name: string
  path: string
}

function glob(path: string) {
  return `${path.replace(/[\\/]+$/, "")}${path.includes("\\") ? "\\*" : "/*"}`
}

export function win(input: string) {
  const path = String(Path.pretty(input, { platform: "win32" }))
  const posix = String(Path.posix(path, { platform: "win32" }))
  const drive = posix.match(/^([A-Z]):/)?.[1]
  if (!drive) throw new Error(`Expected Windows path: ${input}`)
  const rest = posix.slice(2)
  const base: Item[] = [
    { name: "native", path },
    { name: "slash", path: posix },
    { name: "git", path: `/${drive.toLowerCase()}${rest}` },
    { name: "cygwin", path: `/cygdrive/${drive.toLowerCase()}${rest}` },
    { name: "wsl", path: `/mnt/${drive.toLowerCase()}${rest}` },
  ]
  return base.map((item) => ({ ...item, glob: glob(item.path) }))
}
