import { beforeEach, describe, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Path } from "../../../src/path/path"
import { tmpdir } from "../../fixture/fixture"

const seen = {
  tui: [] as (string | undefined)[],
  inst: [] as string[],
}

mock.module("../../../src/cli/cmd/tui/app", () => ({
  tui: async (input: { directory?: string }) => {
    seen.tui.push(input.directory)
  },
}))

mock.module("@/config/tui", () => ({
  TuiConfig: {
    get: () => ({}),
  },
}))

mock.module("@/project/instance", () => ({
  Instance: {
    provide: async (input: { directory: string; fn: () => Promise<unknown> | unknown }) => {
      seen.inst.push(input.directory)
      return input.fn()
    },
  },
}))

mock.module("../../../src/cli/cmd/tui/win32", () => ({
  win32DisableProcessedInput: () => {},
  win32InstallCtrlCGuard: () => undefined,
}))

mock.module("@/cli/ui", () => ({
  UI: {
    error: () => {},
  },
}))

describe("tui attach", () => {
  beforeEach(() => {
    seen.tui.length = 0
    seen.inst.length = 0
  })

  async function call(dir?: string, url = "http://localhost:4096") {
    const { AttachCommand } = await import("../../../src/cli/cmd/tui/attach")
    const args: Parameters<NonNullable<typeof AttachCommand.handler>>[0] = {
      _: [],
      $0: "opencode",
      url,
      dir,
      continue: false,
      session: undefined,
      fork: false,
      password: undefined,
    }
    return AttachCommand.handler(args)
  }

  test("normalizes local file uri directories", async () => {
    await using tmp = await tmpdir()
    const cwd = process.cwd()
    const child = path.join(tmp.path, "child")
    await fs.mkdir(child)

    try {
      await call(String(Path.uri(child)))
      expect(seen.inst[0]).toBe(child)
      expect(seen.tui[0]).toBe(child)
    } finally {
      process.chdir(cwd)
    }
  })

  test("keeps remote relative directories raw", async () => {
    await using tmp = await tmpdir()
    const cwd = process.cwd()
    const pwd = process.env.PWD

    try {
      process.chdir(tmp.path)
      process.env.PWD = tmp.path
      await call("remote/app")
      expect(seen.inst[0]).toBe(tmp.path)
      expect(seen.tui[0]).toBe("remote/app")
    } finally {
      process.chdir(cwd)
      if (pwd === undefined) delete process.env.PWD
      else process.env.PWD = pwd
    }
  })

  test("keeps remote absolute directories off the local filesystem", async () => {
    await using tmp = await tmpdir()
    const cwd = process.cwd()
    const pwd = process.env.PWD
    const child = path.join(tmp.path, "child")

    try {
      await fs.mkdir(child)
      process.chdir(tmp.path)
      process.env.PWD = tmp.path
      await call(child, "http://10.0.0.8:4096")
      expect(seen.inst[0]).toBe(tmp.path)
      expect(seen.tui[0]).toBe(child)
    } finally {
      process.chdir(cwd)
      if (pwd === undefined) delete process.env.PWD
      else process.env.PWD = pwd
    }
  })

  test("passes remote UNC directories through without using them for the local instance", async () => {
    await using tmp = await tmpdir()
    const cwd = process.cwd()
    const pwd = process.env.PWD

    try {
      process.chdir(tmp.path)
      process.env.PWD = tmp.path
      await call("file://server/share/code/../repo", "http://10.0.0.8:4096")
      expect(seen.inst[0]).toBe(tmp.path)
      expect(seen.tui[0]).toBe("\\\\server\\share\\repo")
    } finally {
      process.chdir(cwd)
      if (pwd === undefined) delete process.env.PWD
      else process.env.PWD = pwd
    }
  })

  test("preserves undecodable remote file URI segments across the attach boundary", async () => {
    await using tmp = await tmpdir()
    const cwd = process.cwd()
    const pwd = process.env.PWD

    try {
      process.chdir(tmp.path)
      process.env.PWD = tmp.path
      await call("file:///tmp/%ZZ/repo", "http://10.0.0.8:4096")
      expect(seen.inst[0]).toBe(tmp.path)
      expect(seen.tui[0]).toBe("/tmp/%ZZ/repo")
    } finally {
      process.chdir(cwd)
      if (pwd === undefined) delete process.env.PWD
      else process.env.PWD = pwd
    }
  })
})
