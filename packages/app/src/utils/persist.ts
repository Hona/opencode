import { Platform, usePlatform } from "@/context/platform"
import { getIndexedDBRepository, type DocumentAddress, type Repository } from "@/persistence"
import { checksum } from "@opencode-ai/core/util/encode"
import { createResource, type Accessor } from "solid-js"
import { reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import { pathKey } from "@/utils/path-key"
import { ScopedKey, ServerScope, type ServerScope as ServerScopeValue } from "@/utils/server-scope"

type InitType = Promise<string> | string | null
type PersistedWithReady<T> = [
  Store<T>,
  SetStoreFunction<T>,
  InitType,
  Accessor<boolean> & { promise: undefined | Promise<unknown> },
]

type PersistTarget = {
  storage?: string
  scope?: "window"
  legacyStorageNames?: string[]
  key: string
  legacy?: string[]
  migrate?: (value: unknown) => unknown
}

type LegacyValue = {
  value: string
  remove(): void
}

const LEGACY_STORAGE = "default.dat"
const GLOBAL_STORAGE = "opencode.global.dat"
const WINDOW_STORAGE = "opencode.window"

function snapshot(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function merge(defaults: unknown, value: unknown): unknown {
  if (value === undefined) return defaults
  if (value === null) return value
  if (Array.isArray(defaults)) return Array.isArray(value) ? value : defaults
  if (!isRecord(defaults)) return value
  if (!isRecord(value)) return defaults

  const result: Record<string, unknown> = { ...defaults }
  Object.keys(value).forEach((key) => {
    result[key] = key in defaults ? merge(defaults[key], value[key]) : value[key]
  })
  return result
}

function parse(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function normalize(defaults: unknown, raw: string, migrate?: (value: unknown) => unknown) {
  const parsed = parse(raw)
  if (parsed === undefined) return
  return JSON.stringify(merge(defaults, migrate ? migrate(parsed) : parsed))
}

async function migrateAttachmentData(persistence: Repository, raw: string) {
  if (!raw.includes('"dataUrl"')) return raw
  const visit = async (value: unknown): Promise<unknown> => {
    if (Array.isArray(value)) return Promise.all(value.map(visit))
    if (!isRecord(value)) return value
    if (value.type === "image" && typeof value.dataUrl === "string") {
      const match = /^data:[^;,]+;base64,(.*)$/s.exec(value.dataUrl)
      if (!match) return value
      const decoded = atob(match[1])
      const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0))
      const blob = await persistence.putBlob(bytes)
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== "dataUrl")
          .concat([["blob", blob]]),
      )
    }
    return Object.fromEntries(
      await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await visit(item)])),
    )
  }
  return JSON.stringify(await visit(parse(raw)))
}

function workspaceStorage(dir: string) {
  const head = (dir.slice(0, 12) || "workspace").replace(/[^a-zA-Z0-9._-]/g, "-")
  const sum = checksum(dir) ?? "0"
  return `opencode.workspace.${head}.${sum}.dat`
}

function draftStorage(draftID: string) {
  const head = (draftID.slice(0, 12) || "draft").replace(/[^a-zA-Z0-9._-]/g, "-")
  const sum = checksum(draftID) ?? "0"
  return `opencode.draft.${head}.${sum}.dat`
}

function windowStorage(windowID: string) {
  const safe = (windowID || "browser").replace(/[^a-zA-Z0-9._-]/g, "-")
  return `${WINDOW_STORAGE}.${safe}.dat`
}

function legacyWorkspaceStorage(dir: string) {
  const storage = workspaceStorage(pathKey(dir))
  const result = new Set<string>()
  const raw = workspaceStorage(dir)
  if (raw !== storage) result.add(raw)

  const key = pathKey(dir)
  if (key.length >= 3 && key[1] === ":" && key[2] === "/") {
    const backslash = workspaceStorage(key.replaceAll("/", "\\"))
    if (backslash !== storage) result.add(backslash)
  }
  return result.size ? [...result] : undefined
}

function serverWorkspaceTarget(scope: ServerScopeValue, dir: string, key: string, legacy?: string[]): PersistTarget {
  if (scope !== ServerScope.local) return { storage: workspaceStorage(ScopedKey.from(scope, pathKey(dir))), key }
  return { storage: workspaceStorage(pathKey(dir)), legacyStorageNames: legacyWorkspaceStorage(dir), key, legacy }
}

function resolveTarget(target: PersistTarget, platform: Platform): PersistTarget {
  if (target.scope !== "window") return target
  if (platform.platform === "desktop" && !platform.windowID) return { ...target, storage: GLOBAL_STORAGE }
  return {
    ...target,
    storage: windowStorage(platform.platform === "desktop" ? (platform.windowID ?? "browser") : "browser"),
  }
}

function address(target: PersistTarget): DocumentAddress {
  return { storage: target.storage ?? LEGACY_STORAGE, key: target.key }
}

function repository(platform: Platform) {
  return platform.persistence ?? getIndexedDBRepository()
}

function legacyItem(storage: string | undefined, key: string): LegacyValue | undefined {
  const name = storage ? `${storage}:${key}` : key
  try {
    const value = localStorage.getItem(name)
    if (value === null) return
    return {
      value,
      remove: () => {
        try {
          localStorage.removeItem(name)
        } catch {}
      },
    }
  } catch {
    return
  }
}

function removeLegacy(storage: string | undefined, key: string) {
  legacyItem(storage, key)?.remove()
}

function readLegacy(target: PersistTarget, defaults: unknown) {
  const current = legacyItem(target.storage, target.key)
  if (current) {
    const value = normalize(defaults, current.value, target.migrate)
    if (value === undefined) {
      current.remove()
      return null
    }
    return { value, source: current }
  }

  for (const storage of target.legacyStorageNames ?? []) {
    const source = legacyItem(storage, target.key)
    if (!source) continue
    const value = normalize(defaults, source.value, target.migrate)
    if (value === undefined) {
      source.remove()
      continue
    }
    return { value, source }
  }

  for (const key of target.legacy ?? []) {
    const source = legacyItem(undefined, key)
    if (!source) continue
    const value = normalize(defaults, source.value, target.migrate)
    if (value === undefined) {
      source.remove()
      continue
    }
    return { value, source }
  }
  return null
}

async function readRepositoryLegacy(persistence: Repository, target: PersistTarget, defaults: unknown) {
  const candidates = [
    ...(target.legacyStorageNames ?? []).map((storage) => ({ storage, key: target.key })),
    ...(target.legacy ?? []).map((key) => ({ storage: LEGACY_STORAGE, key })),
  ]
  for (const candidate of candidates) {
    const raw = await persistence.read(candidate)
    if (raw === null) continue
    const value = normalize(defaults, raw, target.migrate)
    if (value === undefined) {
      await persistence.remove(candidate)
      continue
    }
    return {
      value,
      source: { remove: () => persistence.remove(candidate) },
    }
  }
  return null
}

const DRAFT_PERSISTED_KEYS = ["prompt", "comments", "file-view", "layout"]

export function draftPersistedKeys() {
  return DRAFT_PERSISTED_KEYS
}

export const PersistTesting = {
  normalize,
  resolveTarget,
  windowStorage,
  workspaceStorage,
}

export const Persist = {
  global(key: string, legacy?: string[]): PersistTarget {
    return { storage: GLOBAL_STORAGE, key, legacy }
  },
  window(key: string, legacy?: string[]): PersistTarget {
    return { scope: "window", key, legacy }
  },
  draft(draftID: string, key: string, legacy?: string[]): PersistTarget {
    return { storage: draftStorage(draftID), key: `draft:${key}`, legacy }
  },
  serverGlobal(scope: ServerScopeValue, key: string, legacy?: string[]): PersistTarget {
    if (scope === ServerScope.local) return Persist.global(key, legacy)
    return { storage: GLOBAL_STORAGE, key: ScopedKey.from(scope, key) }
  },
  workspace(dir: string, key: string, legacy?: string[]): PersistTarget {
    return serverWorkspaceTarget(ServerScope.local, dir, `workspace:${key}`, legacy)
  },
  serverWorkspace(scope: ServerScopeValue, dir: string, key: string, legacy?: string[]): PersistTarget {
    return serverWorkspaceTarget(scope, dir, `workspace:${key}`, legacy)
  },
  session(dir: string, session: string, key: string, legacy?: string[]): PersistTarget {
    return serverWorkspaceTarget(ServerScope.local, dir, `session:${session}:${key}`, legacy)
  },
  serverSession(scope: ServerScopeValue, dir: string, session: string, key: string, legacy?: string[]): PersistTarget {
    return serverWorkspaceTarget(scope, dir, `session:${session}:${key}`, legacy)
  },
  scoped(dir: string, session: string | undefined, key: string, legacy?: string[]): PersistTarget {
    if (session) return Persist.session(dir, session, key, legacy)
    return Persist.workspace(dir, key, legacy)
  },
  serverScoped(scope: ServerScopeValue, dir: string, session: string | undefined, key: string, legacy?: string[]) {
    if (session) return Persist.serverSession(scope, dir, session, key, legacy)
    return Persist.serverWorkspace(scope, dir, key, legacy)
  },
}

export function removePersisted(
  target: { storage?: string; scope?: "window"; legacyStorageNames?: string[]; key: string; legacy?: string[] },
  platform?: Platform,
) {
  const config = platform ? resolveTarget(target, platform) : target
  removeLegacy(config.storage, config.key)
  config.legacyStorageNames?.forEach((storage) => removeLegacy(storage, config.key))
  config.legacy?.forEach((key) => removeLegacy(undefined, key))
  const persistence = platform?.persistence ?? getIndexedDBRepository()
  return Promise.all([
    persistence.remove(address(config)),
    ...(config.legacyStorageNames ?? []).map((storage) => persistence.remove({ storage, key: config.key })),
    ...(config.legacy ?? []).map((key) => persistence.remove({ storage: LEGACY_STORAGE, key })),
  ]).then(() => undefined)
}

export function persisted<T>(
  target: string | PersistTarget,
  store: [Store<T>, SetStoreFunction<T>],
): PersistedWithReady<T> {
  const platform = usePlatform()
  const config = resolveTarget(typeof target === "string" ? { key: target } : target, platform)
  const persistence = repository(platform)
  const document = address(config)
  const defaults = snapshot(store[0])
  let mutations = 0

  const init = (async () => {
    const current = await persistence.read(document)
    if (mutations) return current ?? ""
    if (current !== null) {
      const normalized = normalize(defaults, current, config.migrate)
      if (normalized === undefined) {
        await persistence.remove(document)
        return ""
      }
      const value = await migrateAttachmentData(persistence, normalized)
      if (!mutations) store[1](reconcile(parse(value) as T))
      if (current !== value) persistence.commit({ address: document, value })
      return value
    }

    const legacy = (await readRepositoryLegacy(persistence, config, defaults)) ?? readLegacy(config, defaults)
    if (!legacy || mutations) return ""
    const value = await migrateAttachmentData(persistence, legacy.value)
    persistence.commit({ address: document, value })
    await persistence.drain()
    await legacy.source.remove()
    if (!mutations) store[1](reconcile(parse(value) as T))
    return value
  })()

  const setState = ((...args: unknown[]) => {
    Reflect.apply(store[1] as unknown as (...values: unknown[]) => void, undefined, args)
    mutations += 1
    persistence.commit({ address: document, value: () => JSON.stringify(snapshot(store[0])) })
  }) as unknown as SetStoreFunction<T>

  const [ready] = createResource(
    () => init,
    async (value: Promise<string>) => {
      await value
      return true
    },
    { initialValue: false },
  )

  return [store[0], setState, init, Object.assign(() => !ready.loading && ready.latest === true, { promise: init })]
}
