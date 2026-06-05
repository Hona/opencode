import { createSimpleContext } from "@opencode-ai/ui/context"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { batch, createMemo, createRoot, getOwner, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useModels } from "@/context/models"
import { useProviders } from "@/hooks/use-providers"
import { Persist, persisted } from "@/utils/persist"
import { cycleModelVariant, getConfiguredAgentVariant, resolveModelVariant } from "./model-variant"
import { DirectoryState, type DirectoryStateScope, useDirectory, useSync } from "@/context/directory"
import { ScopedKey, type ServerScope } from "@/utils/server-scope"
import { createScopedCache } from "@/utils/scoped-cache"

export type ModelKey = { providerID: string; modelID: string; variant?: string }

type State = {
  agent?: string
  model?: ModelKey
  variant?: string | null
}

type Saved = {
  session: Record<string, State | undefined>
}

const migrate = (value: unknown) => {
  if (!value || typeof value !== "object") return { session: {} }

  const item = value as {
    session?: Record<string, State | undefined>
    pick?: Record<string, State | undefined>
  }

  if (item.session && typeof item.session === "object") return { session: item.session }
  if (!item.pick || typeof item.pick !== "object") return { session: {} }

  return {
    session: item.pick,
  }
}

const clone = (value: State | undefined) => {
  if (!value) return
  return {
    ...value,
    model: value.model ? { ...value.model } : undefined,
  } satisfies State
}

type Scope = DirectoryStateScope

function createLocalWorkspace(scope: ServerScope, directory: string) {
  const [saved, setSaved] = persisted(
    {
      ...Persist.serverWorkspace(scope, directory, "model-selection", ["model-selection.v1"]),
      migrate,
    },
    createStore<Saved>({
      session: {},
    }),
  )

  return { saved, setSaved }
}

function createLocalState(scope: Scope, workspace: ReturnType<typeof createLocalWorkspace>) {
  if (scope.state.type === "session") {
    const id = scope.state.id
    return {
      scope,
      current: () => workspace.saved.session[id],
      write: (next: State) => workspace.setSaved("session", id, next),
      clear: () => workspace.setSaved("session", id, undefined),
      restore(next: State) {
        if (workspace.saved.session[id] !== undefined) return
        workspace.setSaved("session", id, next)
      },
    }
  }

  const [store, setStore] =
    scope.state.type === "draft"
      ? persisted(DirectoryState.persist(scope, "model-selection"), createStore<{ value?: State }>({ value: undefined }))
      : createStore<{ value?: State }>({ value: undefined })

  return {
    scope,
    current: () => store.value,
    write: (next: State) => setStore({ value: next }),
    clear: () => setStore({ value: undefined }),
    restore() {},
  }
}

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const directory = useDirectory()
    const sync = useSync()
    const providers = useProviders(() => directory().directory)
    const models = useModels()
    const list = createMemo(() => sync().data.agent.filter((item) => item.mode !== "subagent" && !item.hidden))
    const connected = createMemo(() => new Set(providers.connected().map((item) => item.id)))
    const owner = getOwner()
    const workspaceCache = createScopedCache(
      (_key: ScopedKey, scope: Scope) =>
        createRoot((dispose) => ({ value: createLocalWorkspace(scope.serverScope, scope.directory), dispose }), owner),
      { dispose: (entry) => entry.dispose() },
    )
    const stateCache = createScopedCache((_key: ScopedKey, scope: Scope) => {
      const workspace = workspaceCache.get(
        ScopedKey.from(scope.serverScope, scope.directory),
        scope,
      ).value
      return createLocalState(scope, workspace)
    })
    onCleanup(() => stateCache.clear())
    onCleanup(() => workspaceCache.clear())

    const select = (scope: Scope) => stateCache.get(DirectoryState.key(scope), scope)
    const state = createMemo(() => {
      const current = directory()
      return select({ serverScope: current.server.scope, directory: current.directory, state: current.state })
    })

    const validModel = (model: ModelKey) => {
      const provider = providers.all().get(model.providerID)
      return !!provider?.models[model.modelID] && connected().has(model.providerID)
    }

    const firstModel = (...items: Array<() => ModelKey | undefined>) => {
      for (const item of items) {
        const model = item()
        if (!model) continue
        if (validModel(model)) return model
      }
    }

    const pickAgent = (name: string | undefined) => {
      const items = list()
      if (items.length === 0) return
      return items.find((item) => item.name === name) ?? items[0]
    }

    const scope = () => state().current()

    const configuredModel = () => {
      const modelConfig = sync().data.config.model
      if (!modelConfig) return
      const [providerID, modelID] = modelConfig.split("/")
      const model = { providerID, modelID }
      if (validModel(model)) return model
    }

    const recentModel = () => {
      for (const item of models.recent.list()) {
        if (validModel(item)) return item
      }
    }

    const defaultModel = () => {
      const defaults = providers.default()
      for (const provider of providers.connected()) {
        const configured = defaults[provider.id]
        if (configured) {
          const model = { providerID: provider.id, modelID: configured }
          if (validModel(model)) return model
        }

        const first = Object.values(provider.models)[0]
        if (!first) continue
        const model = { providerID: provider.id, modelID: first.id }
        if (validModel(model)) return model
      }
    }

    const fallback = createMemo<ModelKey | undefined>(() => configuredModel() ?? recentModel() ?? defaultModel())

    const agent = {
      list,
      current() {
        return pickAgent(scope()?.agent)
      },
      set(name: string | undefined) {
        const item = pickAgent(name)
        if (!item) return

        batch(() => {
          const prev = scope()
          state().write({
            agent: item.name,
            model: item.model ?? prev?.model,
            variant: item.variant ?? prev?.variant,
          })
        })
      },
      move(direction: 1 | -1) {
        const items = list()
        if (items.length === 0) return

        let next = items.findIndex((item) => item.name === agent.current()?.name) + direction
        if (next < 0) next = items.length - 1
        if (next >= items.length) next = 0
        const item = items[next]
        if (!item) return
        agent.set(item.name)
      },
    }

    const current = () => {
      const item = firstModel(
        () => scope()?.model,
        () => agent.current()?.model,
        fallback,
      )
      if (!item) return
      return models.find(item)
    }

    const configured = () => {
      const item = agent.current()
      const model = current()
      if (!item || !model) return
      return getConfiguredAgentVariant({
        agent: { model: item.model, variant: item.variant },
        model: { providerID: model.provider.id, modelID: model.id, variants: model.variants },
      })
    }

    const selected = () => scope()?.variant

    const snapshot = () => {
      const model = current()
      return {
        agent: agent.current()?.name,
        model: model ? { providerID: model.provider.id, modelID: model.id } : undefined,
        variant: selected(),
      } satisfies State
    }

    const write = (next: Partial<State>) => {
      const nextState = {
        ...(scope() ?? { agent: agent.current()?.name }),
        ...next,
      } satisfies State
      state().write(nextState)
    }

    const recent = createMemo(() => models.recent.list().map(models.find).filter(Boolean))

    const model = {
      ready: models.ready,
      current,
      recent,
      list: models.list,
      cycle(direction: 1 | -1) {
        const items = recent()
        const item = current()
        if (!item) return

        const index = items.findIndex((entry) => entry?.provider.id === item.provider.id && entry?.id === item.id)
        if (index === -1) return

        let next = index + direction
        if (next < 0) next = items.length - 1
        if (next >= items.length) next = 0

        const entry = items[next]
        if (!entry) return
        model.set({ providerID: entry.provider.id, modelID: entry.id })
      },
      set(item: ModelKey | undefined, options?: { recent?: boolean }) {
        batch(() => {
          write({ model: item })
          if (!item) return
          models.setVisibility(item, true)
          if (!options?.recent) return
          models.recent.push(item)
        })
      },
      visible(item: ModelKey) {
        return models.visible(item)
      },
      setVisibility(item: ModelKey, visible: boolean) {
        models.setVisibility(item, visible)
      },
      variant: {
        configured,
        selected,
        current() {
          const resolved = resolveModelVariant({
            variants: this.list(),
            selected: this.selected(),
            configured: this.configured(),
          })
          if (resolved) return resolved
          const model = current()
          if (!model) return
          const saved = models.variant.get({ providerID: model.provider.id, modelID: model.id })
          if (saved && this.list().includes(saved)) return saved
        },
        list() {
          const item = current()
          if (!item?.variants) return []
          return Object.keys(item.variants)
        },
        set(value: string | undefined) {
          batch(() => {
            const model = current()
            write({ variant: value ?? null })
            if (model) {
              models.variant.set({ providerID: model.provider.id, modelID: model.id }, value ?? undefined)
            }
          })
        },
        cycle() {
          const items = this.list()
          if (items.length === 0) return
          this.set(
            cycleModelVariant({
              variants: items,
              selected: this.selected(),
              configured: this.configured(),
            }),
          )
        },
      },
    }

    const result = {
      slug: createMemo(() => base64Encode(directory().directory)),
      model,
      agent,
      session: {
        bind() {
          const source = state()
          const serverScope = directory().server.scope
          const selected = clone(snapshot())
          return {
            promote(dir: string, session: string) {
              const destination = select({ serverScope, directory: dir, state: { type: "session", id: session } })
              if (selected) destination.write(selected)
              if (source !== destination) source.clear()
            },
          }
        },
        reset() {
          const current = state().scope
          select({ ...current, state: { type: "workspace" } }).clear()
        },
        promote(dir: string, session: string) {
          this.bind().promote(dir, session)
        },
        restore(msg: { sessionID: string; agent: string; model: ModelKey }) {
          const current = state()
          if (msg.sessionID !== DirectoryState.sessionID(current.scope.state)) return
          current.restore({
            agent: msg.agent,
            model: msg.model,
            variant: msg.model?.variant ?? null,
          })
        },
      },
    }
    return result
  },
})
