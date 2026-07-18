import { describe, expect, test, vi } from "bun:test"
import { BaseSidecarController, createLocalSidecarController, createWslSidecarController } from "./types"

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

  test("createLocalSidecarController wraps local server startup and stop", async () => {
    const stopMock = vi.fn().mockResolvedValue(undefined)
    const startMock = vi.fn().mockResolvedValue({
      url: "http://127.0.0.1:4096",
      listener: { stop: stopMock },
    })

    const sidecar = createLocalSidecarController("local-main", startMock)
    expect(sidecar.kind).toBe("local")
    expect(sidecar.status).toBe("idle")

    const url = await sidecar.getUrl()
    expect(url).toBe("http://127.0.0.1:4096")
    expect(sidecar.status).toBe("ready")

    await sidecar.stop()
    expect(stopMock).toHaveBeenCalled()
    expect(sidecar.status).toBe("stopped")
  })

  test("createWslSidecarController wraps WSL server startup and stop", async () => {
    const stopMock = vi.fn()
    const startMock = vi.fn().mockResolvedValue({
      url: "http://127.0.0.1:8080",
      listener: { stop: stopMock },
    })

    const sidecar = createWslSidecarController("Ubuntu", startMock)
    expect(sidecar.kind).toBe("wsl")
    expect(sidecar.status).toBe("idle")

    const url = await sidecar.getUrl()
    expect(url).toBe("http://127.0.0.1:8080")
    expect(sidecar.status).toBe("ready")

    await sidecar.stop()
    expect(stopMock).toHaveBeenCalled()
    expect(sidecar.status).toBe("stopped")
  })
})
