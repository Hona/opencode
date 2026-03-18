import { afterEach, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

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

test("Instance keeps alias directories and reload disposes stored state", async () => {
  await using tmp = await tmpdir({ git: true })
  const alias = await link(tmp.path)
  const seen: string[] = []
  let n = 0
  const state = Instance.state(
    () => ({ n: ++n, dir: Instance.directory }),
    async (value) => {
      seen.push(value.dir)
    },
  )

  try {
    const a = await Instance.provide({
      directory: `${alias}${path.sep}work${path.sep}..`,
      fn: async () => state(),
    })

    expect(a.dir).toBe(alias)

    await Instance.reload({
      directory: `${alias}${path.sep}.${path.sep}`,
    })

    const b = await Instance.provide({
      directory: alias,
      fn: async () => state(),
    })

    expect(b).not.toBe(a)
    expect(b.dir).toBe(alias)
    expect(seen).toEqual([alias])
  } finally {
    await fs.rm(alias, { recursive: true, force: true }).catch(() => undefined)
  }
})

test("Instance dedupes concurrent equivalent directories by key", async () => {
  await using tmp = await tmpdir({ git: true })
  const alias = await link(tmp.path)
  let n = 0

  try {
    const [a, b] = await Promise.all([
      Instance.provide({
        directory: `${alias}${path.sep}work${path.sep}..`,
        init: async () => {
          n += 1
          await Bun.sleep(10)
        },
        fn: async () => Instance.directory,
      }),
      Instance.provide({
        directory: `${alias}${path.sep}.${path.sep}`,
        init: async () => {
          n += 1
          await Bun.sleep(10)
        },
        fn: async () => Instance.directory,
      }),
    ])

    expect(a).toBe(alias)
    expect(b).toBe(alias)
    expect(n).toBe(1)
  } finally {
    await fs.rm(alias, { recursive: true, force: true }).catch(() => undefined)
  }
})
