import { describe, expect, test } from "bun:test"
import path from "path"
import { toPosix } from "@opencode-ai/util/path"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import { FileTime } from "../../src/file/time"
import { Log } from "../../src/util/log"
import { DiagnosticSeverity } from "vscode-languageserver-types"
import type { Diagnostic } from "vscode-languageserver-types"

Log.init({ print: false })

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

let map: Record<string, Diagnostic[]> = {}

async function withLspMock(fn: () => Promise<void>) {
  const mod = await import("../../src/lsp")
  const originalDiagnostics = mod.LSP.diagnostics
  const originalTouch = mod.LSP.touchFile
  const originalPretty = mod.LSP.Diagnostic.pretty
  mod.LSP.diagnostics = async () => map
  mod.LSP.touchFile = async () => {}
  mod.LSP.Diagnostic.pretty = (d: Diagnostic) => d.message
  try {
    await fn()
  } finally {
    mod.LSP.diagnostics = originalDiagnostics
    mod.LSP.touchFile = originalTouch
    mod.LSP.Diagnostic.pretty = originalPretty
  }
}

describe("tool diagnostics key normalization", () => {
  test("accepts posix diagnostics keys", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { lsp: false },
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.txt"), "hello")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withLspMock(async () => {
          const { EditTool } = await import("../../src/tool/edit")
          const file = path.join(tmp.path, "a.txt")
          const posix = toPosix(file)
          const normalized = Filesystem.normalizePath(file)
          map = {
            [posix]: [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                message: "issue",
                severity: DiagnosticSeverity.Error,
              },
            ],
          }

          FileTime.read(ctx.sessionID, posix)
          const edit = await EditTool.init()
          const result = await edit.execute(
            {
              filePath: file,
              oldString: "hello",
              newString: "world",
            },
            ctx,
          )

          expect(result.output).toContain("LSP errors detected")
          if (normalized !== posix) {
            expect(result.output).toContain("issue")
          }
        })
      },
    })
  })

  test("windows: accepts canonical diagnostics keys", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir({
      git: true,
      config: { lsp: false },
      init: async (dir) => {
        await Bun.write(path.join(dir, "b.txt"), "old")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withLspMock(async () => {
          const { WriteTool } = await import("../../src/tool/write")
          const file = path.join(tmp.path, "b.txt")
          const raw = file.toUpperCase()
          const input = toPosix(raw)
          const canonical = Filesystem.normalizePath(input)
          map = {
            [canonical]: [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                message: "issue",
                severity: DiagnosticSeverity.Error,
              },
            ],
          }

          FileTime.read(ctx.sessionID, input)
          const write = await WriteTool.init()
          const result = await write.execute(
            {
              filePath: raw,
              content: "new",
            },
            ctx,
          )

          expect(result.output).toContain("LSP errors detected")
          expect(result.output).toContain("issue")
        })
      },
    })
  })
})
