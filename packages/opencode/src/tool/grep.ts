import z from "zod"
import { Tool } from "./tool"
import { Ripgrep } from "../file/ripgrep"

import DESCRIPTION from "./grep.txt"
import { Instance } from "../project/instance"

const MAX_LINE_LENGTH = 2000
const MATCH_LIMIT = 100

export const GrepTool = Tool.define("grep", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
    include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
  }),
  async execute(params) {
    if (!params.pattern) {
      throw new Error("pattern is required")
    }

    const searchPath = params.path || Instance.directory

    const rgPath = await Ripgrep.filepath()
    const args = ["-nH", "--field-match-separator=|", "--regexp", params.pattern]
    if (params.include) {
      args.push("--glob", params.include)
    }
    args.push(searchPath)

    const proc = Bun.spawn([rgPath, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    const matches: Array<{
      path: string
      modTime: number
      lineNum: number
      lineText: string
    }> = []
    let hitCollectLimit = false

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (!line) continue
          if (matches.length >= MATCH_LIMIT) {
            hitCollectLimit = true
            break
          }

          const [filePath, lineNumStr, ...lineTextParts] = line.split("|")
          if (!filePath || !lineNumStr || lineTextParts.length === 0) continue

          const lineNum = parseInt(lineNumStr, 10)
          const lineText = lineTextParts.join("|")

          const file = Bun.file(filePath)
          const stats = await file.stat().catch(() => null)
          if (!stats) continue

          matches.push({
            path: filePath,
            modTime: stats.mtime.getTime(),
            lineNum,
            lineText,
          })
        }

        if (hitCollectLimit) break
      }

      if (!hitCollectLimit && buffer) {
        const [filePath, lineNumStr, ...lineTextParts] = buffer.split("|")
        if (filePath && lineNumStr && lineTextParts.length > 0) {
          const lineNum = parseInt(lineNumStr, 10)
          const lineText = lineTextParts.join("|")
          const file = Bun.file(filePath)
          const stats = await file.stat().catch(() => null)
          if (stats) {
            matches.push({
              path: filePath,
              modTime: stats.mtime.getTime(),
              lineNum,
              lineText,
            })
          }
        }
      }
    } finally {
      if (hitCollectLimit) proc.kill()
      reader.releaseLock()
    }

    const errorOutput = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    if (exitCode === 1 && matches.length === 0) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    if (exitCode !== 0 && exitCode !== 1 && !hitCollectLimit) {
      throw new Error(`ripgrep failed: ${errorOutput}`)
    }

    matches.sort((a, b) => b.modTime - a.modTime)

    const truncated = matches.length > MATCH_LIMIT
    const finalMatches = truncated ? matches.slice(0, MATCH_LIMIT) : matches

    if (finalMatches.length === 0) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    const outputLines = [`Found ${finalMatches.length} matches`]

    let currentFile = ""
    for (const match of finalMatches) {
      if (currentFile !== match.path) {
        if (currentFile !== "") {
          outputLines.push("")
        }
        currentFile = match.path
        outputLines.push(`${match.path}:`)
      }
      const truncatedLineText =
        match.lineText.length > MAX_LINE_LENGTH ? match.lineText.substring(0, MAX_LINE_LENGTH) + "..." : match.lineText
      outputLines.push(`  Line ${match.lineNum}: ${truncatedLineText}`)
    }

    if (truncated || hitCollectLimit) {
      outputLines.push("")
      outputLines.push("(Results are truncated. Consider using a more specific path or pattern.)")
    }

    return {
      title: params.pattern,
      metadata: {
        matches: finalMatches.length,
        truncated: truncated || hitCollectLimit,
      },
      output: outputLines.join("\n"),
    }
  },
})
