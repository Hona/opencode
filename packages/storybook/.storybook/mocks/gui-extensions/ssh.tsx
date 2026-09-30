import { useDialog } from "@opencode/ui/context/dialog"
import { showToast } from "@opencode/ui/toast"
import { createContext, createEffect, createSignal, For, onCleanup, Show, untrack, useContext } from "solid-js"
import type { ParentProps } from "solid-js"
import { HomeProjectsView, type HomeProjectsViewProps } from "@/home/projects/view"
import { ExtensionHostProvider, useExtensionHost } from "@/runtime/extension/host"
import { Contribution, ExtensionStyles } from "@/runtime/extension/render"
import { ExtensionServersProvider, useExtensionServers, useServerAddItems } from "@/runtime/extension/servers"
import { useLanguage } from "@/runtime/i18n/language"
import { PlatformProvider, usePlatform, type Platform } from "@/runtime/platform/platform"
import { ServerConnection } from "@/runtime/server/registry"
import type { ServerCollectionController } from "@/servers/registry/controller"
import { ServerHealthIndicator } from "@/servers/registry/row"
import { ServerRowItems } from "@/servers/registry/row-items"
import { builtins } from "../../../../gui-extensions/src/renderer"
import { App, Layout, type RemoteClient, type ServerRow } from "../../../../gui-extensions/src/sdk"
import type { Ssh, SshConfig, SshHttp, SshItem, SshStart } from "../../../../gui-extensions/src/ssh/contract"
import { DialogSsh } from "../../../../gui-extensions/src/ssh/dialog"
import { createSshController } from "../../../../gui-extensions/src/ssh/state"
import { createStoryApp } from "../../extension"
// Settings rows render inside the app's settings page, which brings these styles.
import "@/settings/settings.css"

// The app API the SSH dialog stories were written against, before SSH moved into its GUI extension. The SSH
// extension's renderer runs in the app's extension host; only its main process and the host's app and layout
// services are stood in for. Every piece below renders the renderer's contributions as the app does.

export { useLanguage }
export type { SshItem }
export type SshState = { servers: readonly SshItem[] }
export type SshPlatform = {
  getState(): Promise<SshState>
  subscribe(callback: (state: SshState) => void): () => void
  hosts(): Promise<readonly string[]>
  start(input: SshStart): Promise<void>
  resolve(id: string): Promise<SshHttp | null>
  respond(id: string, prompt: string, value: string): Promise<void>
  disconnect(id: string): Promise<void>
  cancel(id: string): Promise<void>
  forget(id: string): Promise<void>
  openConfig(): Promise<void>
}
type SshRemote = RemoteClient<(typeof Ssh)["spec"]>

const extension = builtins.find((definition) => definition.id === "ssh")!
const none = new Set<string>()
const SshPlatformContext = createContext<SshPlatform>()
const SshRemoteContext = createContext<SshRemote>()

function StoryPlatformProvider(props: ParentProps<{ value: Platform & { sshServers?: SshPlatform } }>) {
  return (
    <SshPlatformContext.Provider value={props.value.sshServers}>
      <PlatformProvider value={props.value}>{props.children}</PlatformProvider>
    </SshPlatformContext.Provider>
  )
}

// Stands in for the SSH extension's main entry: the story's platform fixture answers the remote.
function createSshMain(platform: SshPlatform): SshRemote {
  const [state, setState] = createSignal<{ servers: readonly SshItem[]; revision: number }>()
  const publish = (next: SshState) =>
    setState((current) => ({ servers: next.servers, revision: (current?.revision ?? 0) + 1 }))
  void platform.getState().then(publish)
  onCleanup(platform.subscribe(publish))
  const revision = () => state()?.revision ?? 0
  return {
    state,
    on: () => () => {},
    // Background restores leave the fixture alone: the stories show saved servers this window has not reconnected,
    // as they did when the app mounted its restore outside them.
    start: (input) => (input.background ? Promise.resolve(revision()) : platform.start(input).then(revision)),
    resolve: (input) => platform.resolve(input.id),
    respond: (input) => platform.respond(input.id, input.prompt, input.value),
    cancel: (input) => platform.cancel(input.id),
    forget: (input) => platform.forget(input.id),
  }
}

export function SshProvider(props: ParentProps) {
  const platform = useContext(SshPlatformContext)
  const remote = platform && createSshMain(platform)
  const app = createStoryApp(usePlatform().platform)
  const layout = new Proxy({} as Layout, {
    get: () => () => {
      throw new Error("The host layout is unavailable in SSH stories")
    },
  })
  return (
    <ExtensionHostProvider
      definitions={[extension]}
      disabled={() => none}
      services={[
        { token: App, create: () => app },
        { token: Layout, create: () => layout },
      ]}
      remote={(token) => (token.id === extension.id ? remote : undefined)}
    >
      <SshRemoteContext.Provider value={remote}>
        <SshHost>{props.children}</SshHost>
      </SshRemoteContext.Provider>
    </ExtensionHostProvider>
  )
}

// The app renders contributions once its extensions are active.
function SshHost(props: ParentProps) {
  const host = useExtensionHost()
  return (
    <ExtensionServersProvider failed={(id) => host.state.status[id] === "failed"}>
      <ExtensionStyles />
      <Show when={host.state.status[extension.id] === "active"}>{props.children}</Show>
    </ExtensionServersProvider>
  )
}

export function useSsh() {
  const remote = useContext(SshRemoteContext)
  const servers = useExtensionServers()
  const entry = (id: string) => servers.entry(`ssh:${id}`)?.entry
  return {
    get servers() {
      return remote?.state()?.servers ?? []
    },
    pending: (id: string) => entry(id)?.state === "starting",
    connect: (config: SshConfig) => void entry(config.id)?.connect?.(),
  }
}

export function useSshAuthenticate() {
  return ServerConnection.authenticate
}

function StoryDialogSsh(props: { config?: SshConfig; connect?: boolean }) {
  if (props.config) return <PresetDialogSsh config={props.config} connect={props.connect} />
  return <AddDialogSsh />
}

// The story opens this inside a dialog of its own; the SSH extension's "server.add" menu item opens the real one.
function AddDialogSsh() {
  const dialog = useDialog()
  const items = useServerAddItems()
  const state = { opened: false }
  createEffect(() => {
    const item = items()[0]
    if (!item || state.opened) return
    state.opened = true
    untrack(() => {
      dialog.close()
      item.run("")
    })
  })
  return null
}

// No production entry point opens the dialog with a preset host, so these stories render it with a controller of
// their own over the same main process.
function PresetDialogSsh(props: { config: SshConfig; connect?: boolean }) {
  const remote = useContext(SshRemoteContext)
  const language = useLanguage()
  const ssh = createSshController({
    items: () => remote?.state()?.servers ?? [],
    api: () => remote,
    // The stand-in main publishes an attempt's state before `start` resolves.
    refresh: () => Promise.resolve(),
    error: () => showToast({ variant: "error", title: language.t("common.requestFailed") }),
  })
  return (
    <Contribution extension={extension.id}>
      {() => <DialogSsh ssh={ssh} config={props.config} connect={props.connect} />}
    </Contribution>
  )
}

namespace StoryServerConnection {
  export type Ssh = {
    type: "ssh"
    id?: string
    host: string
    displayName?: string
    label?: string
    http: ServerConnection.HttpBase
    connecting?: boolean
    authenticationRequired?: boolean
  }
  export const key = (conn: Ssh) => ServerConnection.Key.make(`ssh:${conn.id ?? conn.host}`)
}

// The home list shows the server the SSH extension contributes for each story server.
function StoryHomeProjectsView(
  props: Omit<HomeProjectsViewProps, "servers"> & { servers: StoryServerConnection.Ssh[] },
) {
  const servers = useExtensionServers()
  return (
    <HomeProjectsView
      {...props}
      servers={servers
        .list()
        .filter((conn) =>
          props.servers.some((server) => StoryServerConnection.key(server) === ServerConnection.key(conn)),
        )}
    />
  )
}

// The cover the SSH extension contributes over a session of a server that is not ready.
export function SshConnectionPanel(props: { item: SshItem; pending?: boolean; onReconnect: () => void }) {
  const servers = useExtensionServers()
  return (
    <Show when={servers.entry(`ssh:${props.item.config.id}`)}>
      {(source) => (
        <Contribution extension={source().extension}>{() => source().entry.cover?.({ tab: "story" })}</Contribution>
      )}
    </Show>
  )
}

// The settings page's rows for contributed servers, as `settings/servers/servers.tsx` renders them.
export function SshServerSettings(props: { filter: string; id?: string; domain: ServerCollectionController }) {
  const servers = useExtensionServers()
  const keys = () =>
    servers
      .entries()
      .filter(
        (item) =>
          item.extension === extension.id &&
          (!props.id || item.entry.id === props.id) &&
          item.entry.name.toLowerCase().includes(props.filter.toLowerCase()),
      )
      .map((item) => ServerConnection.Key.make(item.key))
  return <For each={keys()}>{(key) => <ExtensionServerRow server={key} domain={props.domain} />}</For>
}

function ExtensionServerRow(props: { server: ServerConnection.Key; domain: ServerCollectionController }) {
  const servers = useExtensionServers()
  const source = untrack(() => servers.entry(props.server))
  const row: ServerRow = {
    key: props.server,
    health: () => props.domain.collection.health()[props.server],
    Indicator: (indicator) => (
      <ServerHealthIndicator
        health={indicator.health}
        connecting={indicator.connecting}
        authenticationRequired={indicator.auth}
      />
    ),
    default: {
      available: () => props.domain.defaults.available(),
      current: () => props.domain.defaults.key() === props.server,
      set: (value) => void props.domain.defaults.set(value ? props.server : null),
    },
    remove: () => props.domain.connection.remove(props.server),
    Items: () => <ServerRowItems server={props.server} />,
  }
  if (!source) return null
  return <Contribution extension={source.extension}>{() => untrack(() => source.entry.row?.(row))}</Contribution>
}

export {
  StoryDialogSsh as DialogSsh,
  StoryHomeProjectsView as HomeProjectsView,
  StoryPlatformProvider as PlatformProvider,
  StoryServerConnection as ServerConnection,
}
