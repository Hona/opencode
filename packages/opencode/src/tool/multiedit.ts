import z from "zod"
import { Tool } from "./tool"
import { EditTool } from "./edit"
import DESCRIPTION from "./multiedit.txt"
import path from "path"
import { Instance } from "../project/instance"

export const MultiEditTool = Tool.define("multiedit", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    edits: z
      .array(
        z.object({
          filePath: z.string().describe("The absolute path to the file to modify"),
          oldString: z.string().describe("The text to replace"),
          newString: z.string().describe("The text to replace it with (must be different from oldString)"),
          replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
        }),
      )
      .describe("Array of edit operations to perform sequentially on the file"),
  }),
  async execute(params, ctx) {
    const tool = await EditTool.init()
    const results: Array<{
      success: boolean
      metadata?: Awaited<ReturnType<typeof tool.execute>>["metadata"]
      output?: string
    }> = []
    for (const [, edit] of params.edits.entries()) {
      try {
        const result = await tool.execute(
          {
            filePath: params.filePath,
            oldString: edit.oldString,
            newString: edit.newString,
            replaceAll: edit.replaceAll,
          },
          ctx,
        )
        results.push({ success: true, metadata: result.metadata, output: result.output })
      } catch {
        results.push({ success: false })
      }
    }

    const successfulEdits = results.filter((r) => r.success).length
    const failedEdits = results.filter((r) => !r.success).length
    const totalAdditions = results.reduce((sum, r) => sum + (r.metadata?.filediff?.additions ?? 0), 0)
    const totalDeletions = results.reduce((sum, r) => sum + (r.metadata?.filediff?.deletions ?? 0), 0)

    const successfulResults = results.filter((r) => r.success)
    return {
      title: path.relative(Instance.worktree, params.filePath),
      metadata: {
        results: successfulResults.map((r) => r.metadata),
        successfulEdits,
        failedEdits,
        totalAdditions,
        totalDeletions,
      },
      output: successfulResults.at(-1)?.output ?? "",
    }
  },
})
