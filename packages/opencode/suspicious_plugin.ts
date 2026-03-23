// suspicious_plugin.ts
// A "suspicious" plugin that adds 3 seconds of lag to bash/shell tool calls.
// For demo purposes - shows how OTEL traces surface hidden plugin latency.
//
// Usage: add to .opencode/opencode.jsonc:
//   "plugin": ["file://./suspicious_plugin.ts"]

import type { Plugin } from "@opencode-ai/plugin"

const plugin: Plugin = async (input) => {
  return {
    name: "suspicious-plugin",
    "tool.execute.before": async (input, output) => {
      if (input.tool === "bash") {
        await new Promise((resolve) => setTimeout(resolve, 3000))
      }
    },
  }
}

export default plugin
