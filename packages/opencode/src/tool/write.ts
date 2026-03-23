import z from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { createTwoFilesPatch } from "diff"
import DESCRIPTION from "./write.txt"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { FileTime } from "../file/time"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { trimDiff } from "./edit"
import { assertExternalDirectory } from "./external-directory"
import { Telemetry } from "@/telemetry"

const MAX_DIAGNOSTICS_PER_FILE = 20
const MAX_PROJECT_DIAGNOSTICS_FILES = 5

export const WriteTool = Tool.define("write", {
  description: DESCRIPTION,
  parameters: z.object({
    content: z.string().describe("The content to write to the file"),
    filePath: z.string().describe("The absolute path to the file to write (must be absolute, not relative)"),
    createDiff: z.boolean().optional().describe("Whether to create and show a diff"),
    useLspDiagnostics: z.boolean().optional().describe("Whether to get LSP diagnostics after writing"),
  }),
  async execute(params, ctx) {
    const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    await assertExternalDirectory(ctx, filepath)

    return Telemetry.withSpan("tool.write.execute", {
      "file.path": filepath,
      "write.create_diff": params.createDiff ?? false,
      "write.use_lsp_diagnostics": params.useLspDiagnostics ?? false,
    }, async (span) => {
      const file = Bun.file(filepath)
      const exists = await file.exists()
      const contentOld = exists ? await file.text() : ""
      
      span.setAttribute("file.existed", exists)
      span.setAttribute("file.size_bytes_old", contentOld.length)
      span.setAttribute("file.size_bytes_new", params.content.length)
      span.setAttribute("file.size_delta", params.content.length - contentOld.length)
      
      if (exists) await FileTime.assert(ctx.sessionID, filepath)

      const diff = trimDiff(createTwoFilesPatch(filepath, filepath, contentOld, params.content))
      if (params.createDiff) {
        span.setAttribute("write.diff_lines", diff.split('\n').length)
      }
      
      await ctx.ask({
        permission: "edit",
        patterns: [path.relative(Instance.worktree, filepath)],
        always: ["*"],
        metadata: {
          filepath,
          diff,
        },
      })

      await Bun.write(filepath, params.content)
      await Bus.publish(File.Event.Edited, {
        file: filepath,
      })
      await Bus.publish(FileWatcher.Event.Updated, {
        file: filepath,
        event: exists ? "change" : "add",
      })
      FileTime.read(ctx.sessionID, filepath)

      let output = "Wrote file successfully."
      
      if (params.useLspDiagnostics) {
        await LSP.touchFile(filepath, true)
        const diagnostics = await LSP.diagnostics()
        const normalizedFilepath = Filesystem.normalizePath(filepath)
        let projectDiagnosticsCount = 0
        let errorCount = 0
        const totalDiagnosticFiles = Object.keys(diagnostics).length
        
        for (const [file, issues] of Object.entries(diagnostics)) {
          const errors = issues.filter((item) => item.severity === 1)
          errorCount += errors.length
          if (errors.length === 0) continue
          const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
          const suffix =
            errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
          if (file === normalizedFilepath) {
            output += `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${filepath}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
            continue
          }
          if (projectDiagnosticsCount >= MAX_PROJECT_DIAGNOSTICS_FILES) continue
          projectDiagnosticsCount++
          output += `\n\nLSP errors detected in other files:\n<diagnostics file="${file}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
        }
        
        span.setAttribute("lsp.diagnostics.count", totalDiagnosticFiles)
        span.setAttribute("lsp.errors.count", errorCount)
      }

      return {
        title: path.relative(Instance.worktree, filepath),
        metadata: {
          filepath,
          exists: exists,
          fileCreated: !exists,
        },
        output,
      }
    })
  },
})
