import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { dir } from "../../src/cli/cmd/dir"
import { Path } from "../../src/path/path"
import { tmpdir } from "../fixture/fixture"

describe("cli dir", () => {
  test("resolves relative dirs from the logical cwd", async () => {
    await using tmp = await tmpdir()
    const link = path.join(path.dirname(tmp.path), path.basename(tmp.path) + "-link")
    const type = process.platform === "win32" ? "junction" : "dir"
    await fs.mkdir(path.join(tmp.path, "child"))
    await fs.symlink(tmp.path, link, type)

    try {
      expect(dir("child", { cwd: link })).toBe(path.join(link, "child"))
    } finally {
      await fs.rm(link, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  test("keeps remote relative dirs raw", () => {
    expect(dir("remote/app", { cwd: "/tmp/root", remote: true })).toBe("remote/app")
  })

  test("normalizes remote file uris", async () => {
    await using tmp = await tmpdir()
    const child = path.join(tmp.path, "child")
    await fs.mkdir(child)

    expect(dir(String(Path.uri(child)), { remote: true })).toBe(child)
  })
})
