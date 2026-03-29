import { afterAll, afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"

const env = {
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  XDG_STATE_HOME: process.env.XDG_STATE_HOME,
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
  OPENCODE_TEST_HOME: process.env.OPENCODE_TEST_HOME,
  OPENCODE_DISABLE_DEFAULT_PLUGINS: process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS,
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-plugin-trigger-xdg-"))

process.env.XDG_CONFIG_HOME = path.join(root, "config")
process.env.XDG_DATA_HOME = path.join(root, "data")
process.env.XDG_STATE_HOME = path.join(root, "state")
process.env.XDG_CACHE_HOME = path.join(root, "cache")
process.env.OPENCODE_TEST_HOME = path.join(root, "home")
process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "1"

const { Plugin } = await import("../../src/plugin/index")
const { Instance } = await import("../../src/project/instance")

afterEach(async () => {
  await Instance.disposeAll()
})

afterAll(async () => {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await fs.rm(root, { recursive: true, force: true })
})

async function project(source: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-plugin-trigger-"))
  const file = path.join(dir, "plugin.ts")
  await Bun.write(file, source)
  await Bun.write(
    path.join(dir, "opencode.json"),
    JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        plugin: [pathToFileURL(file).href],
      },
      null,
      2,
    ),
  )

  return {
    path: dir,
    async [Symbol.asyncDispose]() {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}

describe("plugin.trigger", () => {
  test("runs synchronous hooks without crashing", async () => {
    await using tmp = await project(
      [
        "export default async () => ({",
        '  "experimental.chat.system.transform": (_input, output) => {',
        '    output.system.unshift("sync")',
        "  },",
        "})",
        "",
      ].join("\n"),
    )

    const out = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const out = { system: [] as string[] }
        await Plugin.trigger(
          "experimental.chat.system.transform",
          {
            model: {
              providerID: "anthropic",
              modelID: "claude-sonnet-4-6",
            } as any,
          },
          out,
        )
        return out
      },
    })

    expect(out.system).toEqual(["sync"])
  })

  test("awaits asynchronous hooks", async () => {
    await using tmp = await project(
      [
        "export default async () => ({",
        '  "experimental.chat.system.transform": async (_input, output) => {',
        "    await Bun.sleep(1)",
        '    output.system.unshift("async")',
        "  },",
        "})",
        "",
      ].join("\n"),
    )

    const out = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const out = { system: [] as string[] }
        await Plugin.trigger(
          "experimental.chat.system.transform",
          {
            model: {
              providerID: "anthropic",
              modelID: "claude-sonnet-4-6",
            } as any,
          },
          out,
        )
        return out
      },
    })

    expect(out.system).toEqual(["async"])
  })
})
