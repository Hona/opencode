import { describe, expect, test, vi } from "bun:test"
import { BaseSidecarController } from "./types"

describe("SidecarController Interface", () => {
  test("manages sidecar lifecycle state transitions", async () => {
    const fetchUrl = vi.fn().mockResolvedValue("http://127.0.0.1:4096")
    const stopFn = vi.fn().mockResolvedValue(undefined)

    const controller = new BaseSidecarController("local-1", "local", fetchUrl, stopFn)

    expect(controller.status).toBe("idle")

    const url = await controller.getUrl()
    expect(url).toBe("http://127.0.0.1:4096")
    expect(controller.status).toBe("ready")

    await controller.stop()
    expect(stopFn).toHaveBeenCalled()
    expect(controller.status).toBe("stopped")
  })

  test("handles startup failures gracefully", async () => {
    const fetchUrl = vi.fn().mockRejectedValue(new Error("Failed to start server"))
    const stopFn = vi.fn().mockResolvedValue(undefined)

    const controller = new BaseSidecarController("wsl-ubuntu", "wsl", fetchUrl, stopFn)

    expect(controller.getUrl()).rejects.toThrow("Failed to start server")
    expect(controller.status).toBe("failed")
  })
})
