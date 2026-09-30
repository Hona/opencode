import type { MainStorage } from "@opencode/gui-extensions/sdk/main"
import { Option, Schema } from "effect"
import type { StateStore } from "../storage/state"
import { getStore } from "../storage/store"

/** Each extension's values live in the `state` table under `extension.<id>`, stored as canonical JSON. */
export function createMainStorage(state: StateStore, id: string): MainStorage {
  const name = namespace(id)
  return {
    store(key, options) {
      const codec = Schema.toCodecJson(options.schema)
      const legacy = options.from ? source(state, options.from) : undefined
      const cached: { value?: { current: typeof options.initial } } = {}
      const read = () => {
        const stored = state.get(name, key)
        if (stored !== null) return Schema.decodeUnknownOption(Schema.fromJsonString(codec))(stored)
        const found = legacy?.()
        if (found === undefined) return Option.none()
        const decoded = Schema.decodeUnknownOption(codec)(found)
        // Imported once; the old location keeps its copy for builds that still read it.
        if (Option.isSome(decoded)) state.set(name, key, JSON.stringify(found))
        return decoded
      }
      return {
        get() {
          cached.value ??= { current: Option.getOrElse(read(), () => options.initial) }
          return cached.value.current
        },
        set(value) {
          state.set(name, key, JSON.stringify(Schema.encodeSync(codec)(value)))
          cached.value = { current: value }
        },
      }
    },
  }
}

export function namespace(id: string) {
  return `extension.${id}`
}

// `settings:<key>` reads the JSON settings file; `state:<name>/<key>` reads another state namespace.
function source(state: StateStore, from: string): () => unknown {
  if (from.startsWith("settings:")) {
    const key = from.slice("settings:".length)
    return () => getStore().get(key)
  }
  if (from.startsWith("state:")) {
    const [name = "", ...rest] = from.slice("state:".length).split("/")
    const key = rest.join("/")
    return () => {
      const value = state.get(name, key)
      if (value === null) return undefined
      return Option.getOrUndefined(Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(value))
    }
  }
  throw new Error(`Unsupported storage import: ${from}`)
}
