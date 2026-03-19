import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { LSPServer } from "../../src/lsp/server"
import { Path } from "../../src/path/path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("LSPServer.RustAnalyzer.root", () => {
  test("stops before prefix-collision siblings outside worktree", async () => {
    await using tmp = await tmpdir({ git: true })
    const other = tmp.path + "-other"

    try {
      await fs.mkdir(path.join(other, "member", "src"), { recursive: true })
      await Bun.write(path.join(other, "Cargo.toml"), "[workspace]\nmembers = [\"member\"]\n")
      await Bun.write(path.join(other, "member", "Cargo.toml"), "[package]\nname = \"member\"\nversion = \"0.1.0\"\n")
      await Bun.write(path.join(other, "member", "src", "lib.rs"), "pub fn it_works() {}\n")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const root = await LSPServer.RustAnalyzer.root(Path.pretty(path.join(other, "member", "src", "lib.rs")))
          expect(String(root)).toBe(path.join(other, "member"))
        },
      })
    } finally {
      await fs.rm(other, { recursive: true, force: true })
    }
  })
})
