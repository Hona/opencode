import { dlopen, JSCallback, ptr } from "bun:ffi"
import { Effect } from "effect"

// Windows announces a sign-out, restart or shutdown, and `taskkill` without /F asks a process to
// close, only by messaging its top-level windows. A detached service has no console and no window,
// so Windows would terminate it without notice. This hidden window receives those messages.

const WM_CLOSE = 0x0010
const WM_QUERYENDSESSION = 0x0011
const WM_ENDSESSION = 0x0016
const PM_REMOVE = 1

// Windows treats a window that leaves a message unanswered for five seconds as hung; polling every
// half second answers well within that and costs an idle service two wake-ups a second.
const pumpInterval = 500

export type Handlers = {
  /** Something asked the process to close, as `taskkill` without /F does. */
  readonly close: () => void
  /** The session is ending. Windows may terminate the process as soon as this returns. */
  readonly end: () => void
}

/** Calls the handlers when Windows asks the process to close or ends the session, for the lifetime of the scope. */
export const watch = Effect.fnUntraced(function* (handlers: Handlers) {
  if (process.platform !== "win32") return
  yield* Effect.acquireRelease(Effect.try({ try: () => open(handlers), catch: (cause) => cause }), (close) =>
    Effect.sync(close),
  ).pipe(Effect.catch((cause) => Effect.logWarning("could not watch for Windows shutdown", { cause })))
})

function open(handlers: Handlers) {
  const user32 = dlopen("user32.dll", {
    RegisterClassExW: { args: ["ptr"], returns: "u16" },
    UnregisterClassW: { args: ["ptr", "ptr"], returns: "i32" },
    CreateWindowExW: {
      args: ["u32", "ptr", "ptr", "u32", "i32", "i32", "i32", "i32", "ptr", "ptr", "ptr", "ptr"],
      returns: "ptr",
    },
    DestroyWindow: { args: ["ptr"], returns: "i32" },
    DefWindowProcW: { args: ["ptr", "u32", "u64", "i64"], returns: "i64" },
    PeekMessageW: { args: ["ptr", "ptr", "u32", "u32", "u32"], returns: "i32" },
    DispatchMessageW: { args: ["ptr"], returns: "i64" },
  })
  const kernel32 = dlopen("kernel32.dll", { GetModuleHandleW: { args: ["ptr"], returns: "ptr" } })
  const instance = kernel32.symbols.GetModuleHandleW(null)
  const name = Buffer.from("OpenCodeService\0", "utf16le")
  const procedure = new JSCallback(
    (window, message, wparam, lparam) => {
      // Agreeing changes nothing yet: another application can still cancel the session end.
      if (message === WM_QUERYENDSESSION) return 1
      if (message === WM_ENDSESSION) {
        if (wparam) handlers.end()
        return 0
      }
      if (message === WM_CLOSE) {
        handlers.close()
        return 0
      }
      return user32.symbols.DefWindowProcW(window, message, wparam, lparam)
    },
    { args: ["ptr", "u32", "u64", "i64"], returns: "i64" },
  )
  const release = () => {
    procedure.close()
    user32.close()
    kernel32.close()
  }
  if (instance === null || procedure.ptr === null) {
    release()
    throw new Error("Windows did not provide a module handle or window procedure")
  }

  // WNDCLASSEXW: cbSize at 0, lpfnWndProc at 8, hInstance at 24, lpszClassName at 64.
  const windowClass = new Uint8Array(80)
  const fields = new DataView(windowClass.buffer)
  fields.setUint32(0, windowClass.byteLength, true)
  fields.setBigUint64(8, BigInt(procedure.ptr), true)
  fields.setBigUint64(24, BigInt(instance), true)
  fields.setBigUint64(64, BigInt(ptr(name)), true)
  if (user32.symbols.RegisterClassExW(windowClass) === 0) {
    release()
    throw new Error("Windows refused to register the service window class")
  }
  const title = Buffer.from("OpenCode service\0", "utf16le")
  const window = user32.symbols.CreateWindowExW(0, name, title, 0, 0, 0, 0, 0, null, null, instance, null)
  if (window === null) {
    user32.symbols.UnregisterClassW(name, instance)
    release()
    throw new Error("Windows refused to create the service window")
  }

  // Messages sent from other processes are delivered inside PeekMessageW; posted ones are dispatched.
  const message = new Uint8Array(48)
  const pump = setInterval(() => {
    while (user32.symbols.PeekMessageW(message, null, 0, 0, PM_REMOVE) !== 0) user32.symbols.DispatchMessageW(message)
  }, pumpInterval)
  pump.unref()

  return () => {
    clearInterval(pump)
    user32.symbols.DestroyWindow(window)
    user32.symbols.UnregisterClassW(name, instance)
    release()
  }
}
