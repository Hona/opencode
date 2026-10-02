/**
 * Host-internal contract between the renderer host (packages/app) and the main host (packages/desktop).
 * Extensions never use this directly; they use Ipc tokens.
 * Payloads are structured-clone values already encoded with the Ipc's schemas. The `remote` fields name an Ipc by id;
 * they keep the IPC message format's field name.
 */

export interface BridgeLayout {
  readonly visible: boolean
  readonly bounds?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly background?: readonly [number, number, number, number]
  readonly radius?: number
}

export interface Installed {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly builtin: boolean
  readonly enabled: boolean
  /** Changes when an installed archive is replaced or reloaded. */
  readonly revision?: string
  readonly error?: string
}

export type BridgeMessage =
  | { readonly type: "state"; readonly remote: string; readonly state: unknown }
  | { readonly type: "event"; readonly remote: string; readonly name: string; readonly data: unknown }
  | { readonly type: "available"; readonly remote: string; readonly available: boolean }
  | { readonly type: "extensions"; readonly list: readonly Installed[] }
  | { readonly type: "menubar"; readonly items: readonly BridgeMenubarItem[] }

export interface BridgeMenubarItem {
  readonly menu: string
  readonly id: string
  readonly label: string
  readonly after?: string
  readonly enabled: boolean
}

export interface Bridge {
  // SAFETY: the reply is the method's output as its schema encoded it; the renderer host decodes it with that schema.
  /* oxlint-disable anti-slop/no-unknown-returns -- see SAFETY above */
  call(
    input: { readonly remote: string; readonly method: string; readonly input: unknown },
    signal?: AbortSignal,
  ): Promise<unknown>
  /* oxlint-enable anti-slop/no-unknown-returns */
  /** Starts state sync for this window. Resolves with the current availability and state. */
  subscribe(ipc: string): Promise<{ readonly available: boolean; readonly state?: unknown }>
  on(listener: (message: BridgeMessage) => void): () => void
  embed(id: string, layout?: BridgeLayout): void
  capture(id: string): Promise<Uint8Array | undefined>
  /** Runs a native menubar item from the in-app (Windows) menu. */
  menubar(id: string): void
  /** Tells main the current server endpoints so `Servers.get(id)` can resolve them. */
  configure(
    servers: readonly {
      readonly id: string
      readonly url: string
      readonly username?: string
      readonly password?: string
    }[],
  ): void
  readonly manager: {
    list(): Promise<readonly Installed[]>
    enable(id: string): Promise<void>
    disable(id: string): Promise<void>
    reload(id: string): Promise<void>
    install(source: Uint8Array | string): Promise<void>
    remove(id: string): Promise<void>
    /** CommonJS renderer bundle of an installed extension. */
    source(id: string): Promise<string>
    asset(id: string, path: string): string
  }
}
