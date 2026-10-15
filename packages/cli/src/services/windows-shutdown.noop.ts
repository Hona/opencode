import { Effect } from "effect"

// The window procedure is a Bun FFI callback, so other runtimes do not watch: when a Windows session
// ends they are terminated without notice, as before.

export type Handlers = {
  readonly close: () => void
  readonly end: () => void
}

export function watch(_handlers: Handlers) {
  return Effect.void
}
