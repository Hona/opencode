import { dlopen } from "bun:ffi"

export function createEvent(name: string) {
  // Windows HANDLE values are integers, not Bun FFI memory pointers.
  const library = dlopen("kernel32.dll", {
    CreateEventW: { args: ["ptr", "i32", "i32", "ptr"], returns: "u64" },
    WaitForSingleObject: { args: ["u64", "u32"], returns: "u32" },
    CloseHandle: { args: ["u64"], returns: "i32" },
    GetLastError: { args: [], returns: "u32" },
  })
  const handle = library.symbols.CreateEventW(null, 0, 0, Buffer.from(`${name}\0`, "utf16le"))
  const code = library.symbols.GetLastError()
  // An existing event may have a different reset mode.
  if (!handle || code === 183) {
    if (handle) library.symbols.CloseHandle(handle)
    library.close()
    throw new Error(`CreateEventW failed: ${code}`)
  }
  return {
    poll() {
      const result = library.symbols.WaitForSingleObject(handle, 0)
      if (result === 0) return true
      if (result === 0x102) return false
      throw new Error(`WaitForSingleObject failed: ${library.symbols.GetLastError()}`)
    },
    close() {
      library.symbols.CloseHandle(handle)
      library.close()
    },
  }
}
