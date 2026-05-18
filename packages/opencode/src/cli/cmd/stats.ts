import { Effect } from "effect"
import { and, eq, gte, sql, type SQL } from "drizzle-orm"
import { effectCmd } from "../effect-cmd"
import { Database } from "@/storage/db"
import { MessageTable, PartTable, SessionTable } from "../../session/session.sql"
import { Project } from "@/project/project"
import { ProjectID } from "@/project/schema"
import { InstanceRef } from "@/effect/instance-ref"

interface SessionStats {
  totalSessions: number
  totalMessages: number
  totalCost: number
  totalTokens: {
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
  toolUsage: Record<string, number>
  modelUsage: Record<
    string,
    {
      messages: number
      tokens: {
        input: number
        output: number
        cache: {
          read: number
          write: number
        }
      }
      cost: number
    }
  >
  dateRange: {
    earliest: number
    latest: number
  }
  days: number
  costPerDay: number
  tokensPerSession: number
  medianTokensPerSession: number
}

export const StatsCommand = effectCmd({
  command: "stats",
  describe: "show token usage and cost statistics",
  builder: (yargs) =>
    yargs
      .option("days", {
        describe: "show stats for the last N days (default: all time)",
        type: "number",
      })
      .option("tools", {
        describe: "number of tools to show (default: all)",
        type: "number",
      })
      .option("models", {
        describe: "show model statistics (default: hidden). Pass a number to show top N, otherwise shows all",
      })
      .option("project", {
        describe: "filter by project (default: all projects, empty string: current project)",
        type: "string",
      }),
  handler: Effect.fn("Cli.stats")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return
    const stats = yield* aggregateSessionStats(args.days, args.project, ctx.project)
    let modelLimit: number | undefined
    if (args.models === true) {
      modelLimit = Infinity
    } else if (typeof args.models === "number") {
      modelLimit = args.models
    }
    displayStats(stats, args.tools, modelLimit)
  }),
})

const aggregateSessionStats = Effect.fn("Cli.stats.aggregate")(function* (
  days?: number,
  projectFilter?: string,
  currentProject?: Project.Info,
) {
  const MS_IN_DAY = 24 * 60 * 60 * 1000
  const projectID = (() => {
    if (projectFilter === undefined) return
    if (projectFilter === "") {
      if (!currentProject) throw new Error("currentProject required when projectFilter is empty string")
      return currentProject.id
    }
    return ProjectID.make(projectFilter)
  })()

  const cutoffTime = (() => {
    if (days === undefined) return 0
    if (days === 0) {
      const now = new Date()
      now.setHours(0, 0, 0, 0)
      return now.getTime()
    }
    return Date.now() - days * MS_IN_DAY
  })()

  const windowDays = (() => {
    if (days === undefined) return
    if (days === 0) return 1
    return days
  })()

  const rows = yield* Effect.sync(() =>
    Database.use((db) => {
      const sessionConditions: SQL[] = []
      if (projectID) sessionConditions.push(eq(SessionTable.project_id, projectID))
      const sessions = db
        .select({
          id: SessionTable.id,
          timeCreated: SessionTable.time_created,
          timeUpdated: SessionTable.time_updated,
        })
        .from(SessionTable)
        .where(where(sessionConditions))
        .all()

      const messageConditions: SQL[] = []
      if (cutoffTime > 0) messageConditions.push(gte(MessageTable.time_created, cutoffTime))
      if (projectID) messageConditions.push(eq(SessionTable.project_id, projectID))
      const messages = db
        .select({ sessionID: MessageTable.session_id, timeCreated: MessageTable.time_created })
        .from(MessageTable)
        .innerJoin(SessionTable, eq(MessageTable.session_id, SessionTable.id))
        .where(where(messageConditions))
        .all()

      const partConditions: SQL[] = [sql`json_extract(${PartTable.data}, '$.type') in ('step-finish', 'tool')`]
      if (cutoffTime > 0) partConditions.push(gte(PartTable.time_created, cutoffTime))
      if (projectID) partConditions.push(eq(SessionTable.project_id, projectID))
      const parts = db
        .select({
          sessionID: PartTable.session_id,
          timeCreated: PartTable.time_created,
          part: PartTable.data,
          message: MessageTable.data,
        })
        .from(PartTable)
        .innerJoin(MessageTable, eq(PartTable.message_id, MessageTable.id))
        .innerJoin(SessionTable, eq(PartTable.session_id, SessionTable.id))
        .where(where(partConditions))
        .all()

      return { sessions, messages, parts }
    }),
  )

  const activeSessionIDs =
    cutoffTime > 0
      ? new Set([...rows.messages.map((row) => row.sessionID), ...rows.parts.map((row) => row.sessionID)])
      : new Set(rows.sessions.map((row) => row.id))

  const stats: SessionStats = {
    totalSessions: activeSessionIDs.size,
    totalMessages: rows.messages.length,
    totalCost: 0,
    totalTokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    toolUsage: {},
    modelUsage: {},
    dateRange: {
      earliest: Date.now(),
      latest: Date.now(),
    },
    days: 0,
    costPerDay: 0,
    tokensPerSession: 0,
    medianTokensPerSession: 0,
  }

  if (activeSessionIDs.size > 1000) {
    console.log(`Large dataset detected (${activeSessionIDs.size} sessions). This may take a while...`)
  }

  if (activeSessionIDs.size === 0) {
    stats.days = windowDays ?? 0
    return stats
  }

  const sessionTotalTokens = new Map([...activeSessionIDs].map((sessionID) => [sessionID, 0]))

  for (const row of rows.parts) {
    if (row.part.type === "tool" && row.part.tool) {
      stats.toolUsage[row.part.tool] = (stats.toolUsage[row.part.tool] || 0) + 1
      continue
    }
    if (row.part.type !== "step-finish") continue

    stats.totalCost += row.part.cost || 0
    stats.totalTokens.input += row.part.tokens.input || 0
    stats.totalTokens.output += row.part.tokens.output || 0
    stats.totalTokens.reasoning += row.part.tokens.reasoning || 0
    stats.totalTokens.cache.read += row.part.tokens.cache.read || 0
    stats.totalTokens.cache.write += row.part.tokens.cache.write || 0
    sessionTotalTokens.set(
      row.sessionID,
      (sessionTotalTokens.get(row.sessionID) || 0) +
        (row.part.tokens.input || 0) +
        (row.part.tokens.output || 0) +
        (row.part.tokens.reasoning || 0) +
        (row.part.tokens.cache.read || 0) +
        (row.part.tokens.cache.write || 0),
    )

    if (row.message.role !== "assistant") continue
    const model = `${row.message.providerID}/${row.message.modelID}`
    if (!stats.modelUsage[model]) {
      stats.modelUsage[model] = {
        messages: 0,
        tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        cost: 0,
      }
    }
    stats.modelUsage[model].messages++
    stats.modelUsage[model].tokens.input += row.part.tokens.input || 0
    stats.modelUsage[model].tokens.output += (row.part.tokens.output || 0) + (row.part.tokens.reasoning || 0)
    stats.modelUsage[model].tokens.cache.read += row.part.tokens.cache.read || 0
    stats.modelUsage[model].tokens.cache.write += row.part.tokens.cache.write || 0
    stats.modelUsage[model].cost += row.part.cost || 0
  }

  const activityTimes =
    cutoffTime > 0
      ? [...rows.messages.map((row) => row.timeCreated), ...rows.parts.map((row) => row.timeCreated)]
      : rows.sessions.flatMap((row) => [row.timeCreated, row.timeUpdated])
  const earliestTime = Math.min(...activityTimes)
  const latestTime = Math.max(...activityTimes)
  const rangeDays = Math.max(1, Math.ceil((latestTime - earliestTime) / MS_IN_DAY))
  const effectiveDays = windowDays ?? rangeDays
  stats.dateRange = {
    earliest: earliestTime,
    latest: latestTime,
  }
  stats.days = effectiveDays
  stats.costPerDay = stats.totalCost / effectiveDays
  const totalTokens =
    stats.totalTokens.input +
    stats.totalTokens.output +
    stats.totalTokens.reasoning +
    stats.totalTokens.cache.read +
    stats.totalTokens.cache.write
  stats.tokensPerSession = activeSessionIDs.size > 0 ? totalTokens / activeSessionIDs.size : 0
  const sessionTokens = [...sessionTotalTokens.values()].sort((a, b) => a - b)
  const mid = Math.floor(sessionTokens.length / 2)
  stats.medianTokensPerSession =
    sessionTokens.length === 0
      ? 0
      : sessionTokens.length % 2 === 0
        ? (sessionTokens[mid - 1] + sessionTokens[mid]) / 2
        : sessionTokens[mid]

  return stats
})

function where(conditions: SQL[]) {
  return conditions.length > 0 ? and(...conditions) : undefined
}

export function displayStats(stats: SessionStats, toolLimit?: number, modelLimit?: number) {
  const width = 56

  function renderRow(label: string, value: string): string {
    const availableWidth = width - 1
    const paddingNeeded = availableWidth - label.length - value.length
    const padding = Math.max(0, paddingNeeded)
    return `│${label}${" ".repeat(padding)}${value} │`
  }

  // Overview section
  console.log("┌────────────────────────────────────────────────────────┐")
  console.log("│                       OVERVIEW                         │")
  console.log("├────────────────────────────────────────────────────────┤")
  console.log(renderRow("Sessions", stats.totalSessions.toLocaleString()))
  console.log(renderRow("Messages", stats.totalMessages.toLocaleString()))
  console.log(renderRow("Days", stats.days.toString()))
  console.log("└────────────────────────────────────────────────────────┘")
  console.log()

  // Cost & Tokens section
  console.log("┌────────────────────────────────────────────────────────┐")
  console.log("│                    COST & TOKENS                       │")
  console.log("├────────────────────────────────────────────────────────┤")
  const cost = isNaN(stats.totalCost) ? 0 : stats.totalCost
  const costPerDay = isNaN(stats.costPerDay) ? 0 : stats.costPerDay
  const tokensPerSession = isNaN(stats.tokensPerSession) ? 0 : stats.tokensPerSession
  console.log(renderRow("Total Cost", `$${cost.toFixed(2)}`))
  console.log(renderRow("Avg Cost/Day", `$${costPerDay.toFixed(2)}`))
  console.log(renderRow("Avg Tokens/Session", formatNumber(Math.round(tokensPerSession))))
  const medianTokensPerSession = isNaN(stats.medianTokensPerSession) ? 0 : stats.medianTokensPerSession
  console.log(renderRow("Median Tokens/Session", formatNumber(Math.round(medianTokensPerSession))))
  console.log(renderRow("Input", formatNumber(stats.totalTokens.input)))
  console.log(renderRow("Output", formatNumber(stats.totalTokens.output)))
  console.log(renderRow("Cache Read", formatNumber(stats.totalTokens.cache.read)))
  console.log(renderRow("Cache Write", formatNumber(stats.totalTokens.cache.write)))
  console.log("└────────────────────────────────────────────────────────┘")
  console.log()

  // Model Usage section
  if (modelLimit !== undefined && Object.keys(stats.modelUsage).length > 0) {
    const sortedModels = Object.entries(stats.modelUsage).sort(([, a], [, b]) => b.messages - a.messages)
    const modelsToDisplay = modelLimit === Infinity ? sortedModels : sortedModels.slice(0, modelLimit)

    console.log("┌────────────────────────────────────────────────────────┐")
    console.log("│                      MODEL USAGE                       │")
    console.log("├────────────────────────────────────────────────────────┤")

    for (const [model, usage] of modelsToDisplay) {
      console.log(`│ ${model.padEnd(54)} │`)
      console.log(renderRow("  Messages", usage.messages.toLocaleString()))
      console.log(renderRow("  Input Tokens", formatNumber(usage.tokens.input)))
      console.log(renderRow("  Output Tokens", formatNumber(usage.tokens.output)))
      console.log(renderRow("  Cache Read", formatNumber(usage.tokens.cache.read)))
      console.log(renderRow("  Cache Write", formatNumber(usage.tokens.cache.write)))
      console.log(renderRow("  Cost", `$${usage.cost.toFixed(4)}`))
      console.log("├────────────────────────────────────────────────────────┤")
    }
    // Remove last separator and add bottom border
    process.stdout.write("\x1B[1A") // Move up one line
    console.log("└────────────────────────────────────────────────────────┘")
  }
  console.log()

  // Tool Usage section
  if (Object.keys(stats.toolUsage).length > 0) {
    const sortedTools = Object.entries(stats.toolUsage).sort(([, a], [, b]) => b - a)
    const toolsToDisplay = toolLimit ? sortedTools.slice(0, toolLimit) : sortedTools

    console.log("┌────────────────────────────────────────────────────────┐")
    console.log("│                      TOOL USAGE                        │")
    console.log("├────────────────────────────────────────────────────────┤")

    const maxCount = Math.max(...toolsToDisplay.map(([, count]) => count))
    const totalToolUsage = Object.values(stats.toolUsage).reduce((a, b) => a + b, 0)

    for (const [tool, count] of toolsToDisplay) {
      const barLength = Math.max(1, Math.floor((count / maxCount) * 20))
      const bar = "█".repeat(barLength)
      const percentage = ((count / totalToolUsage) * 100).toFixed(1)

      const maxToolLength = 18
      const truncatedTool = tool.length > maxToolLength ? tool.substring(0, maxToolLength - 2) + ".." : tool
      const toolName = truncatedTool.padEnd(maxToolLength)

      const content = ` ${toolName} ${bar.padEnd(20)} ${count.toString().padStart(3)} (${percentage.padStart(4)}%)`
      const padding = Math.max(0, width - content.length - 1)
      console.log(`│${content}${" ".repeat(padding)} │`)
    }
    console.log("└────────────────────────────────────────────────────────┘")
  }
  console.log()
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M"
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K"
  }
  return num.toString()
}
