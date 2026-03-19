import type { SelectedLineRange } from "@/context/file"
import { sessionParts } from "@/utils/session-key"

type HandoffSession = {
  prompt: string
  files: Record<string, SelectedLineRange | null>
}

const MAX = 40

const store = {
  session: new Map<string, HandoffSession>(),
  terminal: new Map<string, string[]>(),
}

const touch = <K, V>(map: Map<K, V>, key: K, value: V) => {
  map.delete(key)
  map.set(key, value)
  while (map.size > MAX) {
    const first = map.keys().next().value
    if (first === undefined) return
    map.delete(first)
  }
}

export const setSessionHandoff = (key: string, patch: Partial<HandoffSession>) => {
  const next = sessionParts(key).key
  const prev = store.session.get(next) ?? { prompt: "", files: {} }
  touch(store.session, next, { ...prev, ...patch })
}

export const getSessionHandoff = (key: string) => store.session.get(sessionParts(key).key)

export const setTerminalHandoff = (key: string, value: string[]) => {
  touch(store.terminal, key, value)
}

export const getTerminalHandoff = (key: string) => store.terminal.get(key)
