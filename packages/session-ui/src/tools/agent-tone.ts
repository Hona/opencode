const agentTones = new Map([
  ["ask", "var(--icon-agent-ask-base)"],
  ["build", "var(--icon-agent-build-base)"],
  ["docs", "var(--icon-agent-docs-base)"],
  ["plan", "var(--icon-agent-plan-base)"],
])

const v2AgentTones = new Map([
  ["build", "var(--v2-agent-build-solid)"],
  ["explore", "var(--v2-agent-explore-solid)"],
  ["plan", "var(--v2-agent-plan-solid)"],
  ["review", "var(--v2-agent-review-solid)"],
  ["writer", "var(--v2-agent-writer-solid)"],
])

const agentThemeColors = new Map([
  ["primary", "var(--text-interactive-base)"],
  ["secondary", "var(--text-base)"],
  ["accent", "var(--icon-info-base)"],
  ["success", "var(--icon-success-base)"],
  ["warning", "var(--icon-warning-base)"],
  ["error", "var(--icon-critical-base)"],
  ["info", "var(--icon-info-base)"],
])

const v2AgentThemeColors = new Map([
  ["primary", "var(--v2-text-text-accent)"],
  ["secondary", "var(--v2-text-text-muted)"],
  ["accent", "var(--v2-icon-icon-accent)"],
  ["success", "var(--v2-state-fg-success)"],
  ["warning", "var(--v2-state-fg-warning)"],
  ["error", "var(--v2-state-fg-danger)"],
  ["info", "var(--v2-state-fg-info)"],
])

const agentPalette = [
  "var(--icon-agent-ask-base)",
  "var(--icon-agent-build-base)",
  "var(--icon-agent-docs-base)",
  "var(--icon-agent-plan-base)",
  "var(--syntax-info)",
  "var(--syntax-success)",
  "var(--syntax-warning)",
  "var(--syntax-property)",
  "var(--syntax-constant)",
  "var(--text-diff-add-base)",
  "var(--text-diff-delete-base)",
  "var(--icon-warning-base)",
]

export function taskAgent(raw: string | undefined, list?: readonly { name: string; color?: string }[]) {
  if (!raw) return {}

  const key = raw.toLowerCase()
  const item = list?.find((entry) => entry.name === raw || entry.name.toLowerCase() === key)
  const color = agentColor(item?.color, agentThemeColors) ?? agentTones.get(key) ?? tone(key)

  return {
    name: item?.name ?? `${raw[0].toUpperCase()}${raw.slice(1)}`,
    color,
    v2Color: agentColor(item?.color, v2AgentThemeColors) ?? v2AgentTones.get(key) ?? color,
  }
}

function tone(name: string) {
  const hash = [...name].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0)

  return agentPalette[hash % agentPalette.length]
}

function agentColor(value: string | undefined, themeColors: ReadonlyMap<string, string>) {
  if (!value) return undefined

  return themeColors.get(value) ?? value
}
