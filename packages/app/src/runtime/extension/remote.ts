import { batch } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Schema } from "effect"
import type { Remote, RemoteClient, RemoteSpec } from "@opencode/gui-extensions/sdk"
import type { Bridge } from "@opencode/gui-extensions/sdk/bridge"

/** Renderer-side clients for remotes that extensions provide in the main process. */
export function createRemotes(bridge: Bridge | undefined) {
  const [state, setState] = createStore({
    available: {} as Record<string, boolean | undefined>,
    values: {} as Record<string, unknown>,
  })
  const specs = new Map<string, RemoteSpec>()
  const clients = new Map<string, RemoteClient<RemoteSpec>>()
  const listeners = new Map<string, Set<(name: string, data: unknown) => void>>()
  const subscribed = new Set<string>()

  const decodeState = (id: string, value: unknown) => {
    const schema = specs.get(id)?.state
    return schema ? Schema.decodeUnknownSync(schema)(value) : value
  }

  bridge?.on((message) => {
    if (message.type === "state") {
      if (!specs.has(message.remote)) return
      setState("values", message.remote, reconcile(decodeState(message.remote, message.state)))
      return
    }
    if (message.type === "available") {
      batch(() => {
        setState("available", message.remote, message.available)
        if (!message.available) setState("values", message.remote, undefined)
      })
      return
    }
    if (message.type !== "event") return
    const schema = specs.get(message.remote)?.events?.[message.name]
    const data = schema ? Schema.decodeUnknownSync(schema)(message.data) : message.data
    listeners.get(message.remote)?.forEach((listener) => listener(message.name, data))
  })

  const subscribe = (connected: Bridge, token: Remote) => {
    if (subscribed.has(token.id)) return
    subscribed.add(token.id)
    specs.set(token.id, token.spec)
    void connected.subscribe(token.id).then((result) =>
      batch(() => {
        setState("available", token.id, result.available)
        if (result.state !== undefined) setState("values", token.id, decodeState(token.id, result.state))
      }),
    )
  }

  const create = (connected: Bridge, token: Remote): RemoteClient<RemoteSpec> => {
    const methods = Object.fromEntries(
      Object.entries(token.spec.methods).map(([name, method]) => [
        name,
        async (input: unknown, options?: { signal?: AbortSignal }) => {
          const encoded = method.input ? Schema.encodeUnknownSync(method.input)(input) : null
          const output = await connected.call({ remote: token.id, method: name, input: encoded }, options?.signal)
          return method.output ? Schema.decodeUnknownSync(method.output)(output) : undefined
        },
      ]),
    )
    return Object.assign(methods, {
      state: () => state.values[token.id],
      on(name: string, listener: (data: unknown) => void) {
        const set = listeners.get(token.id) ?? new Set()
        const wrapped = (event: string, data: unknown) => {
          if (event === name) listener(data)
        }
        set.add(wrapped)
        listeners.set(token.id, set)
        return () => {
          set.delete(wrapped)
        }
      },
    }) as unknown as RemoteClient<RemoteSpec>
  }

  return {
    client(token: Remote) {
      if (!bridge) return undefined
      subscribe(bridge, token)
      if (!state.available[token.id]) return undefined
      const existing = clients.get(token.id)
      if (existing) return existing
      const created = create(bridge, token)
      clients.set(token.id, created)
      return created
    },
  }
}
