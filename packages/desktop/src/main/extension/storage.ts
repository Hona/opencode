import type { Storage } from "@opencode/gui-extensions/sdk/main"
import { Option, Schema } from "effect"
import type { StateStore } from "../storage/state"
import { getStore } from "../storage/store"

/** The last value a store read or wrote, so later reads skip the database. */
type Cached<T> = { value?: { current: T } }

/**
 * Each extension's values live in the `state` table under `extension.<id>`, stored as canonical JSON. Writes are rare,
 * so each one reaches the database before it returns and survives a crash.
 */
export function createStorage(state: StateStore, id: string): Storage {
  const name = namespace(id)
  // Resets the caches of the stores opened on each key since its last removal, so they read `initial` again.
  const opened = new Map<string, Set<() => void>>()

  const remove = (key: string, from: string | undefined) => {
    // The old copy goes too, or the next read would import it again.
    if (from) source(state, from).remove()

    if (state.get(name, key) !== null) state.delete(name, key)
    state.flush()
    opened.get(key)?.forEach((reset) => reset())
    opened.delete(key)
  }

  return {
    store(key, options) {
      const codec = Schema.toCodecJson(options.schema)
      const legacy = options.from ? source(state, options.from) : undefined
      const cached: Cached<typeof options.initial> = {}

      const read = () => {
        const stored = state.get(name, key)

        if (stored !== null) return Schema.decodeUnknownOption(Schema.fromJsonString(codec))(stored)
        const found = legacy?.read()

        if (found === undefined) return Option.none()
        const decoded = Schema.decodeUnknownOption(codec)(found)

        // Imported once; the old location keeps its copy for builds that still read it.
        if (Option.isSome(decoded)) state.set(name, key, JSON.stringify(found))

        return decoded
      }

      const current = () => {
        cached.value ??= { current: Option.getOrElse(read(), () => options.initial) }

        return cached.value.current
      }

      // Keeps a decoded copy of what was stored, so the caller's object never aliases the stored value.
      const write = (value: typeof options.initial) => {
        const encoded = Schema.encodeSync(codec)(value)

        state.set(name, key, JSON.stringify(encoded))
        state.flush()
        cached.value = { current: Schema.decodeSync(codec)(encoded) }
      }

      const resets = opened.get(key) ?? new Set()

      resets.add(() => {
        cached.value = { current: options.initial }
      })
      opened.set(key, resets)

      return {
        get value() {
          return current()
        },
        ready: () => true,
        // The draft is a decoded copy, so a mutation never touches the cached value until it is written. A returned
        // value replaces the draft.
        update(mutation) {
          const draft = Schema.decodeSync(codec)(Schema.encodeSync(codec)(current()))
          const next = mutation(draft)

          write(next === undefined ? draft : next)
        },
      }
    },
    remove: (key, options) => remove(key, options?.from),
  }
}

export function namespace(id: string) {
  return `extension.${id}`
}

// `settings:<key>` reads the JSON settings file and `settings:<file>/<key>` another one (e.g. opencode.updater);
// `state:<name>/<key>` reads another state namespace.
function source(state: StateStore, from: string) {
  if (from.startsWith("settings:")) {
    const [file, key] = from.slice("settings:".length).split("/", 2)
    const store = () => (key === undefined ? getStore() : getStore(file))
    const entry = key ?? file ?? ""

    return {
      read: () => store().get(entry),
      remove() {
        if (store().get(entry) !== undefined) store().delete(entry)
      },
    }
  }

  if (from.startsWith("state:")) {
    const [name = "", ...rest] = from.slice("state:".length).split("/")
    const key = rest.join("/")

    return {
      read() {
        const value = state.get(name, key)

        if (value === null) return undefined

        return Option.getOrUndefined(Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(value))
      },
      remove() {
        if (state.get(name, key) !== null) state.delete(name, key)
      },
    }
  }

  throw new Error(`Unsupported storage import: ${from}`)
}
