import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { pathToFileURL } from "url"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ProviderAuth } from "../../src/provider/auth"

describe("plugin.auth-override", () => {
  test("user plugin overrides built-in github-copilot auth", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await Bun.write(
          path.join(pluginDir, "custom-copilot-auth.ts"),
          [
            "export default async () => ({",
            "  auth: {",
            '    provider: "github-copilot",',
            "    methods: [",
            '      { type: "api", label: "Test Override Auth" },',
            "    ],",
            "    loader: async () => ({ access: 'test-token' }),",
            "  },",
            "})",
            "",
          ].join("\n"),
        )
      },
    })

    const originalContent = process.env["OPENCODE_CONFIG_CONTENT"]
    const pluginUrl = pathToFileURL(path.join(tmp.path, ".opencode", "plugin", "custom-copilot-auth.ts")).href
    process.env["OPENCODE_CONFIG_CONTENT"] = JSON.stringify({ plugin: [pluginUrl] })

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const methods = await ProviderAuth.methods()
          const copilot = methods["github-copilot"]
          expect(copilot).toBeDefined()
          expect(copilot.length).toBe(1)
          expect(copilot[0].label).toBe("Test Override Auth")
        },
      })
    } finally {
      if (originalContent === undefined) {
        delete process.env["OPENCODE_CONFIG_CONTENT"]
      } else {
        process.env["OPENCODE_CONFIG_CONTENT"] = originalContent
      }
    }
  }, 30000) // Increased timeout for plugin installation
})
