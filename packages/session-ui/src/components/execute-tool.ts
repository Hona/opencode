export type ExecuteCall = {
  tool: string
  status: "running" | "completed" | "error"
  input?: Record<string, unknown>
}

export function executeCalls(value: unknown): ExecuteCall[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((value) => {
    const call = recordValue(value)
    if (!call || typeof call.tool !== "string") return []
    if (call.status !== "running" && call.status !== "completed" && call.status !== "error") return []
    const input = recordValue(call.input)
    return [{ tool: call.tool, status: call.status, ...(input ? { input } : {}) }]
  })
}

export function executeCallSummary(call: ExecuteCall) {
  return Object.entries(call.input ?? {})
    .filter((entry) => {
      const value = entry[1]
      return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    })
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, " ")}`)
    .join(", ")
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return Object.fromEntries(Object.entries(value))
}
