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

  test("normalizes remote UNC file uris without using the local os", () => {
    expect(dir("file://server/share/code/../repo", { remote: true })).toBe("\\\\server\\share\\repo")
  })

  test("treats localhost remote file uris as local roots", () => {
    expect(dir("file://localhost/C:/Users/me/code/../repo", { remote: true })).toBe("C:\\Users\\me\\repo")
    expect(dir("file://localhost/srv/code/../repo", { remote: true })).toBe("/srv/repo")
  })

  test("preserves undecodable segments in remote file uris", () => {
    expect(dir("file:///tmp/%ZZ/repo", { remote: true })).toBe("/tmp/%ZZ/repo")
  })

  test("normalizes remote windows absolute paths without using the local os", () => {
    expect(dir("/C:/Users/me/code/../repo", { remote: true })).toBe("C:\\Users\\me\\repo")
  })

  test("normalizes remote native windows absolute paths without using the local os", () => {
    expect(dir("C:\\Users\\me\\code\\..\\repo", { remote: true })).toBe("C:\\Users\\me\\repo")
  })

  test("normalizes remote windows drive roots without using the local os", () => {
    expect(dir("/C:", { remote: true })).toBe("C:\\")
  })

  test("normalizes remote UNC backslash paths without using the local os", () => {
    expect(dir("\\\\server\\share\\code\\..\\repo", { remote: true })).toBe("\\\\server\\share\\repo")
  })

  test("preserves remote posix absolute paths without using the local os", () => {
    expect(dir("/srv/code/../repo", { remote: true })).toBe("/srv/repo")
  })
})
