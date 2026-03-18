import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Log } from "../../src/util/log"
import { parseSSE } from "../../src/control-plane/sse"
import { GlobalBus } from "../../src/bus/global"
import { Instance } from "../../src/project/instance"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

mock.module("../../src/project/bootstrap", () => ({
  InstanceBootstrap: async () => {},
}))

const { WorkspaceServer } = await import("../../src/control-plane/workspace-server/server")

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

Log.init({ print: false })

async function link(dir: string) {
  const alias = path.join(path.dirname(dir), path.basename(dir) + "-link")
  await fs.rm(alias, { recursive: true, force: true }).catch(() => undefined)
  await fs.symlink(dir, alias, process.platform === "win32" ? "junction" : "dir")
  return alias
}

describe("control-plane/workspace-server SSE", () => {
  test("streams GlobalBus events and parseSSE reads them", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = WorkspaceServer.App()
    const stop = new AbortController()
    const seen: unknown[] = []
    try {
      const response = await app.request("/event", {
        signal: stop.signal,
        headers: {
          "x-opencode-workspace": "wrk_test_workspace",
          "x-opencode-directory": tmp.path,
        },
      })

      expect(response.status).toBe(200)
      expect(response.body).toBeDefined()

      const done = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("timed out waiting for workspace.test event"))
        }, 3000)

        void parseSSE(response.body!, stop.signal, (event) => {
          seen.push(event)
          const next = event as { type?: string }
          if (next.type === "server.connected") {
            GlobalBus.emit("event", {
              payload: {
                type: "workspace.test",
                properties: { ok: true },
              },
            })
            return
          }
          if (next.type !== "workspace.test") return
          clearTimeout(timeout)
          resolve()
        }).catch((error) => {
          clearTimeout(timeout)
          reject(error)
        })
      })

      await done

      expect(seen.some((event) => (event as { type?: string }).type === "server.connected")).toBe(true)
      expect(seen).toContainEqual({
        type: "workspace.test",
        properties: { ok: true },
      })
    } finally {
      stop.abort()
    }
  })

  test("keeps alias directories before Instance.provide", async () => {
    await using tmp = await tmpdir({ git: true })
    const alias = await link(tmp.path)
    const app = WorkspaceServer.App()
    const stop = new AbortController()
    const provide = Instance.provide
    const spy = spyOn(Instance, "provide").mockImplementation((input) => provide(input))

    try {
      const response = await app.request("/event", {
        signal: stop.signal,
        headers: {
          "x-opencode-workspace": "wrk_test_workspace",
          "x-opencode-directory": `${alias}${path.sep}work${path.sep}..`,
        },
      })

      expect(response.status).toBe(200)
      expect(spy.mock.calls[0]?.[0]?.directory).toBe(alias)
    } finally {
      stop.abort()
      spy.mockRestore()
      await fs.rm(alias, { recursive: true, force: true }).catch(() => undefined)
    }
  })
})
