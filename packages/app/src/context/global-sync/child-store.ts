import { createRoot, getOwner, onCleanup, runWithOwner, type Owner } from "solid-js"
import { createStore, type SetStoreFunction, type Store } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import type { VcsInfo } from "@opencode-ai/sdk/v2/client"
import type { WorkspaceKey } from "@/context/file/path"
import {
  DIR_IDLE_TTL_MS,
  MAX_DIR_STORES,
  type ChildOptions,
  type DirState,
  type IconCache,
  type MetaCache,
  type ProjectMeta,
  type State,
  type VcsCache,
} from "./types"
import { canDisposeDirectory, pickDirectoriesToEvict } from "./eviction"

export function createChildStoreManager(input: {
  owner: Owner
  isBooting: (directory: WorkspaceKey) => boolean
  isLoadingSessions: (directory: WorkspaceKey) => boolean
  onBootstrap: (directory: WorkspaceKey) => void
  onDispose: (directory: WorkspaceKey) => void
  translate: (key: string, vars?: Record<string, string | number>) => string
}) {
  type ChildStore = [Store<State>, SetStoreFunction<State>]

  const children: Record<WorkspaceKey, ChildStore> = {} as Record<WorkspaceKey, ChildStore>
  const vcsCache = new Map<WorkspaceKey, VcsCache>()
  const metaCache = new Map<WorkspaceKey, MetaCache>()
  const iconCache = new Map<WorkspaceKey, IconCache>()
  const lifecycle = new Map<WorkspaceKey, DirState>()
  const pins = new Map<WorkspaceKey, number>()
  const ownerPins = new WeakMap<object, Set<WorkspaceKey>>()
  const disposers = new Map<WorkspaceKey, () => void>()

  const mark = (directory: WorkspaceKey) => {
    lifecycle.set(directory, { lastAccessAt: Date.now() })
    runEviction(directory)
  }

  const pin = (directory: WorkspaceKey) => {
    pins.set(directory, (pins.get(directory) ?? 0) + 1)
    mark(directory)
  }

  const unpin = (directory: WorkspaceKey) => {
    const next = (pins.get(directory) ?? 0) - 1
    if (next > 0) {
      pins.set(directory, next)
      return
    }
    pins.delete(directory)
    runEviction()
  }

  const pinned = (directory: WorkspaceKey) => (pins.get(directory) ?? 0) > 0

  const pinForOwner = (directory: WorkspaceKey) => {
    const current = getOwner()
    if (!current) return
    if (current === input.owner) return
    const owner = current as object
    const set = ownerPins.get(owner)
    if (set?.has(directory)) return
    if (set) set.add(directory)
    if (!set) ownerPins.set(owner, new Set([directory]))
    pin(directory)
    onCleanup(() => {
      const set = ownerPins.get(owner)
      if (set) {
        set.delete(directory)
        if (set.size === 0) ownerPins.delete(owner)
      }
      unpin(directory)
    })
  }

  function dispose(directory: WorkspaceKey) {
    if (
      !canDisposeDirectory({
        directory,
        hasStore: !!children[directory],
        pinned: pinned(directory),
        booting: input.isBooting(directory),
        loadingSessions: input.isLoadingSessions(directory),
      })
    ) {
      return false
    }

    vcsCache.delete(directory)
    metaCache.delete(directory)
    iconCache.delete(directory)
    lifecycle.delete(directory)
    const dispose = disposers.get(directory)
    if (dispose) {
      dispose()
      disposers.delete(directory)
    }
    delete children[directory]
    input.onDispose(directory)
    return true
  }

  function runEviction(skip?: WorkspaceKey) {
    const stores = Object.keys(children) as WorkspaceKey[]
    if (stores.length === 0) return
    const list = pickDirectoriesToEvict({
      stores,
      state: lifecycle,
      pins: new Set(stores.filter(pinned)),
      max: MAX_DIR_STORES,
      ttl: DIR_IDLE_TTL_MS,
      now: Date.now(),
    }).filter((directory) => directory !== skip)
    if (list.length === 0) return
    for (const directory of list) {
      if (!dispose(directory)) continue
    }
  }

  function ensureChild(directory: WorkspaceKey) {
    if (!children[directory]) {
      const vcs = runWithOwner(input.owner, () =>
        persisted(
          Persist.workspace(directory, "vcs", ["vcs.v1"]),
          createStore({ value: undefined as VcsInfo | undefined }),
        ),
      )
      if (!vcs) throw new Error(input.translate("error.childStore.persistedCacheCreateFailed"))
      const vcsStore = vcs[0]
      vcsCache.set(directory, { store: vcsStore, setStore: vcs[1], ready: vcs[3] })

      const meta = runWithOwner(input.owner, () =>
        persisted(
          Persist.workspace(directory, "project", ["project.v1"]),
          createStore({ value: undefined as ProjectMeta | undefined }),
        ),
      )
      if (!meta) throw new Error(input.translate("error.childStore.persistedProjectMetadataCreateFailed"))
      metaCache.set(directory, { store: meta[0], setStore: meta[1], ready: meta[3] })

      const icon = runWithOwner(input.owner, () =>
        persisted(
          Persist.workspace(directory, "icon", ["icon.v1"]),
          createStore({ value: undefined as string | undefined }),
        ),
      )
      if (!icon) throw new Error(input.translate("error.childStore.persistedProjectIconCreateFailed"))
      iconCache.set(directory, { store: icon[0], setStore: icon[1], ready: icon[3] })

      const init = () =>
        createRoot((dispose) => {
          const initialMeta = meta[0].value
          const initialIcon = icon[0].value
          const child = createStore<State>({
            project: "",
            projectMeta: initialMeta,
            icon: initialIcon,
            provider: { all: [], connected: [], default: {} },
            config: {},
            path: {
              os: "linux",
              state: "",
              config: "",
              worktree: "",
              directory: "",
              home: "",
            },
            status: "loading" as const,
            agent: [],
            command: [],
            session: [],
            sessionTotal: 0,
            session_status: {},
            session_diff: {},
            todo: {},
            permission: {},
            question: {},
            mcp: {},
            lsp: [],
            vcs: vcsStore.value,
            limit: 5,
            message: {},
            part: {},
          })
          children[directory] = child
          disposers.set(directory, dispose)

          const onPersistedInit = (init: Promise<string> | string | null, run: () => void) => {
            if (!(init instanceof Promise)) return
            void init.then(() => {
              if (children[directory] !== child) return
              run()
            })
          }

          onPersistedInit(vcs[2], () => {
            const cached = vcsStore.value
            if (!cached?.branch) return
            child[1]("vcs", (value) => value ?? cached)
          })

          onPersistedInit(meta[2], () => {
            if (child[0].projectMeta !== initialMeta) return
            child[1]("projectMeta", meta[0].value)
          })

          onPersistedInit(icon[2], () => {
            if (child[0].icon !== initialIcon) return
            child[1]("icon", icon[0].value)
          })
        })

      runWithOwner(input.owner, init)
    }
    mark(directory)
    const childStore = children[directory]
    if (!childStore) throw new Error(input.translate("error.childStore.storeCreateFailed"))
    return childStore
  }

  function child(directory: WorkspaceKey, options: ChildOptions = {}) {
    const childStore = ensureChild(directory)
    pinForOwner(directory)
    const shouldBootstrap = options.bootstrap ?? true
    if (shouldBootstrap && childStore[0].status === "loading") {
      input.onBootstrap(directory)
    }
    return childStore
  }

  function peek(directory: WorkspaceKey, options: ChildOptions = {}) {
    const childStore = ensureChild(directory)
    const shouldBootstrap = options.bootstrap ?? true
    if (shouldBootstrap && childStore[0].status === "loading") {
      input.onBootstrap(directory)
    }
    return childStore
  }

  function projectMeta(directory: WorkspaceKey, patch: ProjectMeta) {
    const [store, setStore] = ensureChild(directory)
    const cached = metaCache.get(directory)
    if (!cached) return
    const previous = store.projectMeta ?? {}
    const icon = patch.icon ? { ...(previous.icon ?? {}), ...patch.icon } : previous.icon
    const commands = patch.commands ? { ...(previous.commands ?? {}), ...patch.commands } : previous.commands
    const next = {
      ...previous,
      ...patch,
      icon,
      commands,
    }
    cached.setStore("value", next)
    setStore("projectMeta", next)
  }

  function projectIcon(directory: WorkspaceKey, value: string | undefined) {
    const [store, setStore] = ensureChild(directory)
    const cached = iconCache.get(directory)
    if (!cached) return
    if (store.icon === value) return
    cached.setStore("value", value)
    setStore("icon", value)
  }

  return {
    children,
    ensureChild,
    child,
    peek,
    projectMeta,
    projectIcon,
    mark,
    pin,
    unpin,
    pinned,
    dispose,
    runEviction,
    vcsCache,
    metaCache,
    iconCache,
  }
}
