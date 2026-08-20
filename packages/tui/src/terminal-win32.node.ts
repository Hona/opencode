import { dlopen } from "node:ffi"

const STD_INPUT_HANDLE = -10
const ENABLE_PROCESSED_INPUT = 0x0001

const kernel = () =>
  dlopen("kernel32.dll", {
    GetStdHandle: { arguments: ["i32"], return: "pointer" },
    GetConsoleMode: { arguments: ["pointer", "pointer"], return: "i32" },
    SetConsoleMode: { arguments: ["pointer", "u32"], return: "i32" },
    FlushConsoleInputBuffer: { arguments: ["pointer"], return: "i32" },
  }).functions

let k32: ReturnType<typeof kernel> | undefined

function load() {
  if (process.platform !== "win32") return false
  try {
    k32 ??= kernel()
    return true
  } catch {
    return false
  }
}

export function win32DisableProcessedInput() {
  if (process.platform !== "win32" || !process.stdin.isTTY || !load()) return
  const handle = k32!.GetStdHandle(STD_INPUT_HANDLE)
  const buffer = new Uint32Array(1)
  if (k32!.GetConsoleMode(handle, buffer) === 0) return
  const mode = buffer[0]!
  if ((mode & ENABLE_PROCESSED_INPUT) === 0) return
  k32!.SetConsoleMode(handle, mode & ~ENABLE_PROCESSED_INPUT)
}

export function win32FlushInputBuffer() {
  if (process.platform !== "win32" || !process.stdin.isTTY || !load()) return
  k32!.FlushConsoleInputBuffer(k32!.GetStdHandle(STD_INPUT_HANDLE))
}
