import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"

type Migrate = typeof import("./migrate").migrate

const files = new Map<string, string>()
const dirs = new Map<string, string[]>()
const stores = new Map<string, Map<string, unknown>>()
const calls = { getStore: 0 }

const app = { isPackaged: true }
const log = {
  log: mock(() => undefined),
  warn: mock(() => undefined),
}

function getStore(name = "opencode.settings") {
  calls.getStore += 1
  const data = stores.get(name) ?? new Map<string, unknown>()
  stores.set(name, data)
  return {
    has(key: string) {
      return data.has(key)
    },
    get(key: string) {
      return data.get(key)
    },
    set(key: string, value: unknown) {
      data.set(key, value)
    },
  }
}

let migrate: Migrate

beforeAll(async () => {
  mock.module("electron", () => ({ app }))
  mock.module("electron-log/main.js", () => ({ default: log }))
  mock.module("node:fs", () => ({
    existsSync(path: string) {
      return dirs.has(path) || files.has(path)
    },
    readdirSync(path: string) {
      const items = dirs.get(path)
      if (!items) throw new Error(`missing dir ${path}`)
      return items
    },
    readFileSync(path: string) {
      const value = files.get(path)
      if (value === undefined) throw new Error(`missing file ${path}`)
      return value
    },
  }))
  mock.module("./constants", () => ({ CHANNEL: "prod" }))
  mock.module("./store", () => ({ getStore }))

  const mod = await import("./migrate")
  migrate = mod.migrate
})

beforeEach(() => {
  files.clear()
  dirs.clear()
  stores.clear()
  calls.getStore = 0
  log.log.mockClear()
  log.warn.mockClear()
  process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming"
})

describe("migrate", () => {
  test("does not touch stores before migration runs", () => {
    expect(calls.getStore).toBe(0)
  })

  test("migrates tauri dat files once without overwriting electron values", () => {
    const dir = "C:\\Users\\test\\AppData\\Roaming\\ai.opencode.desktop"
    dirs.set(dir, ["default.dat", "opencode.settings.dat", "note.txt"])
    files.set(`${dir}\\default.dat`, JSON.stringify({ fresh: '{"x":1}', keep: '{"old":true}' }))
    files.set(`${dir}\\opencode.settings.dat`, JSON.stringify({ theme: '{"dark":false}' }))

    stores.set("default.dat", new Map([["keep", '{"new":true}']]))

    migrate()

    expect(stores.get("default.dat")?.get("fresh")).toBe('{"x":1}')
    expect(stores.get("default.dat")?.get("keep")).toBe('{"new":true}')
    expect(stores.get("opencode.settings")?.get("theme")).toBe('{"dark":false}')
    expect(stores.get("opencode.settings")?.get("tauriMigrated")).toBe(true)

    files.set(`${dir}\\default.dat`, JSON.stringify({ later: '{"y":2}' }))
    migrate()

    expect(stores.get("default.dat")?.get("later")).toBeUndefined()
  })

  test("marks missing tauri data as already migrated", () => {
    migrate()

    expect(stores.get("opencode.settings")?.get("tauriMigrated")).toBe(true)
    expect(log.warn).not.toHaveBeenCalled()
  })
})
