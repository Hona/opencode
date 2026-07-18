import { describe, expect, test, vi } from "bun:test"
import { invokeIpcWith, handleIpcWith } from "./ipc-contract"

describe("Desktop IPC Contract", () => {
  test("invokeIpcWith calls renderer with typed payload and receives response", async () => {
    const mockInvoke = vi.fn().mockResolvedValue("https://127.0.0.1:4096")
    const mockRenderer = { invoke: mockInvoke } as any

    const result = await invokeIpcWith(mockRenderer, "get-default-server-url", undefined)

    expect(mockInvoke).toHaveBeenCalledWith("get-default-server-url", undefined)
    expect(result).toBe("https://127.0.0.1:4096")
  })

  test("handleIpcWith registers handler with ipcMain and forwards payload", async () => {
    const mockHandle = vi.fn()
    const mockMain = { handle: mockHandle } as any

    handleIpcWith(mockMain, "set-default-server-url", async (url) => {
      return url
    })

    expect(mockHandle).toHaveBeenCalledWith("set-default-server-url", expect.any(Function))

    const registeredHandler = mockHandle.mock.calls[0][1]
    const response = await registeredHandler({}, "http://localhost:8080")
    expect(response).toBe("http://localhost:8080")
  })
})
