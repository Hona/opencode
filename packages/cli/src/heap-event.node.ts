import { dlopen } from "node:ffi"

export function createEvent(name: string) {
  const library = dlopen("kernel32.dll", {
    CreateEventW: { arguments: ["pointer", "int32", "int32", "pointer"], return: "uint64" },
    WaitForSingleObject: { arguments: ["uint64", "uint32"], return: "uint32" },
    CloseHandle: { arguments: ["uint64"], return: "int32" },
    GetLastError: { arguments: [], return: "uint32" },
  })
  const handle = library.functions.CreateEventW(0n, 0, 0, Buffer.from(`${name}\0`, "utf16le"))
  const code = library.functions.GetLastError()
  if (!handle || code === 183) {
    if (handle) library.functions.CloseHandle(handle)
    library.lib.close()
    throw new Error(`CreateEventW failed: ${code}`)
  }
  return {
    poll() {
      const result = library.functions.WaitForSingleObject(handle, 0)
      if (result === 0) return true
      if (result === 0x102) return false
      throw new Error(`WaitForSingleObject failed: ${library.functions.GetLastError()}`)
    },
    close() {
      library.functions.CloseHandle(handle)
      library.lib.close()
    },
  }
}
