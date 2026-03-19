import { afterEach, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

mock.module("../../src/project/bootstrap", () => ({
  InstanceBootstrap: async () => {},
}))

const { Server } = await import("../../src/server/server")

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

async function link(dir: string) {
  const alias = path.join(path.dirname(dir), path.basename(dir) + "-link")
  await fs.rm(alias, { recursive: true, force: true }).catch(() => undefined)
  await fs.symlink(dir, alias, process.platform === "win32" ? "junction" : "dir")
  return alias
}

test("server ingress keeps alias directories", async () => {
  await using tmp = await tmpdir({ git: true })
  const alias = await link(tmp.path)

  try {
    const app = Server.createApp({})
    const response = await app.request("/path", {
      headers: {
        "x-opencode-directory": `${alias}${path.sep}work${path.sep}..`,
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      os: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux",
      directory: alias,
    })
  } finally {
    await fs.rm(alias, { recursive: true, force: true }).catch(() => undefined)
  }
})
