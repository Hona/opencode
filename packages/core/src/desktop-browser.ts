export * as DesktopBrowser from "./desktop-browser"

export const VERSION = 1 as const

export type State = {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  generation: number
}

export type Command =
  | { type: "status" }
  | { type: "navigate"; url: string }
  | { type: "snapshot"; generation: number }
  | { type: "click"; ref: string; generation: number }
  | { type: "fill"; ref: string; text: string; generation: number }
  | {
      type: "press"
      generation: number
      key:
        | "Enter"
        | "Tab"
        | "Escape"
        | "Backspace"
        | "Delete"
        | "ArrowUp"
        | "ArrowDown"
        | "ArrowLeft"
        | "ArrowRight"
        | "PageUp"
        | "PageDown"
        | "Home"
        | "End"
        | "Space"
    }
  | { type: "scroll"; direction: "up" | "down" | "left" | "right"; amount: number; generation: number }
  | { type: "screenshot"; generation: number }

export type Result =
  | { type: "status"; attached: boolean; state?: State }
  | { type: "snapshot"; state: State; content: string }
  | { type: "action"; state: State }
  | { type: "screenshot"; state: State; data: string; width: number; height: number }

export type Request = {
  type: "desktop.browser.request"
  version: typeof VERSION
  requestID: string
  sessionID: string
  command: Command
}

export type Cancel = {
  type: "desktop.browser.cancel"
  version: typeof VERSION
  requestID: string
}

export const ERROR_CODES = [
  "not_attached",
  "stale_ref",
  "invalid_url",
  "navigation_failed",
  "timeout",
  "aborted",
  "page_crashed",
  "result_too_large",
  "protocol",
  "internal",
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export type Response = {
  type: "desktop.browser.response"
  version: typeof VERSION
  requestID: string
  result?: Result
  error?: {
    code: ErrorCode
    message: string
    retryable: boolean
  }
}

export function isRequest(input: unknown): input is Request {
  if (!record(input)) return false
  if (input.type !== "desktop.browser.request" || input.version !== VERSION) return false
  if (typeof input.requestID !== "string" || typeof input.sessionID !== "string") return false
  return command(input.command)
}

export function isCancel(input: unknown): input is Cancel {
  if (!record(input)) return false
  return input.type === "desktop.browser.cancel" && input.version === VERSION && typeof input.requestID === "string"
}

export function isResponse(input: unknown): input is Response {
  if (!record(input)) return false
  if (input.type !== "desktop.browser.response" || input.version !== VERSION || typeof input.requestID !== "string") {
    return false
  }
  if ((input.result === undefined) === (input.error === undefined)) return false
  if (input.error !== undefined) {
    if (!record(input.error)) return false
    if (!oneOf(ERROR_CODES, input.error.code) || typeof input.error.message !== "string") return false
    if (typeof input.error.retryable !== "boolean") return false
  }
  return input.result === undefined || result(input.result)
}

function command(input: unknown): input is Command {
  if (!record(input) || typeof input.type !== "string") return false
  if (input.type === "status") return true
  if (input.type === "snapshot" || input.type === "screenshot") return finite(input.generation)
  if (input.type === "navigate") return typeof input.url === "string"
  if (input.type === "click") return typeof input.ref === "string" && finite(input.generation)
  if (input.type === "fill") {
    return typeof input.ref === "string" && typeof input.text === "string" && finite(input.generation)
  }
  if (input.type === "press") {
    return oneOf(PRESS_KEYS, input.key) && finite(input.generation)
  }
  if (input.type === "scroll") {
    return oneOf(SCROLL_DIRECTIONS, input.direction) && finite(input.amount) && finite(input.generation)
  }
  return false
}

function result(input: unknown): input is Result {
  if (!record(input) || typeof input.type !== "string") return false
  if (input.type === "status") return typeof input.attached === "boolean"
  if (input.type === "snapshot") return state(input.state) && typeof input.content === "string"
  if (input.type === "action") return state(input.state)
  if (input.type === "screenshot") {
    return (
      state(input.state) &&
      typeof input.data === "string" &&
      typeof input.width === "number" &&
      typeof input.height === "number"
    )
  }
  return false
}

function state(input: unknown): input is State {
  if (!record(input)) return false
  return (
    typeof input.url === "string" &&
    typeof input.title === "string" &&
    typeof input.loading === "boolean" &&
    typeof input.canGoBack === "boolean" &&
    typeof input.canGoForward === "boolean" &&
    finite(input.generation)
  )
}

const PRESS_KEYS = [
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "Space",
] as const
const SCROLL_DIRECTIONS = ["up", "down", "left", "right"] as const

function finite(input: unknown): input is number {
  return typeof input === "number" && Number.isFinite(input)
}

function oneOf<const Values extends readonly string[]>(values: Values, input: unknown): input is Values[number] {
  return typeof input === "string" && values.some((value) => value === input)
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
