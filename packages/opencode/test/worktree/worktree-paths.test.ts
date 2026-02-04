import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

function flipCase(value: string) {
  return value.replace(/[A-Za-z]/g, (char) => (char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase()))
}

async function exists(target: string) {
  return fs
    .stat(target)
    .then(() => true)
    .catch(() => false)
}

describe("Worktree path matching", () => {
  if (process.platform !== "win32") return

  test("remove matches worktrees case-insensitively", async () => {
    await using tmp = await tmpdir({ git: true })
    const worktreePath = path.join(
      tmp.path,
      "..",
      `worktree-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    const created = await $`git worktree add ${worktreePath} -b test-branch`.quiet().nothrow().cwd(tmp.path)
    expect(created.exitCode).toBe(0)

    const variant = flipCase(worktreePath)
    expect(variant).not.toBe(worktreePath)

    const removed = await Instance.provide({
      directory: tmp.path,
      fn: async () => Worktree.remove({ directory: variant }),
    })
    expect(removed).toBe(true)
    expect(await exists(worktreePath)).toBe(false)
  })

  test("reset blocks primary workspace case-insensitively", async () => {
    await using tmp = await tmpdir({ git: true })
    const variant = flipCase(tmp.path)
    expect(variant).not.toBe(tmp.path)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(Worktree.reset({ directory: variant })).rejects.toMatchObject({
          name: "WorktreeResetFailedError",
          data: { message: "Cannot reset the primary workspace" },
        })
      },
    })
  })
})
