import { createSimpleContext } from "@opencode/ui/context"
import { useDialog } from "@opencode/ui/context/dialog"
import { Menu } from "@opencode/ui/menu"
import { showToast } from "@opencode/ui/toast"
import { createContext, createEffect, createSignal, For, onCleanup, Show, untrack, useContext } from "solid-js"
import type { ParentProps } from "solid-js"
import { HomeProjectsView, type HomeProjectsViewProps } from "@/home/projects/view"
import { useLanguage } from "@/runtime/i18n/language"
import { PlatformProvider, type Platform } from "@/runtime/platform/platform"
import { ServerConnection } from "@/runtime/server/registry"
import type { ServerCollectionController } from "@/servers/registry/controller"
import { ServerHealthIndicator } from "@/servers/registry/row"
import { useExtension, type RemoteClient, type ServerRow } from "../../../../gui-extensions/src/sdk"
import type { Ssh, SshConfig, SshHttp, SshItem, SshStart } from "../../../../gui-extensions/src/ssh/contract"
import { SshCover, type SshOffer } from "../../../../gui-extensions/src/ssh/cover"
import { DialogSsh } from "../../../../gui-extensions/src/ssh/dialog"
import SshRow from "../../../../gui-extensions/src/ssh/row"
import { createSshController } from "../../../../gui-extensions/src/ssh/state"
// Settings rows render inside the app's settings page, which brings these styles.
import "@/settings/settings.css"

// The app API the SSH dialog stories were written against, before SSH moved into its GUI extension. Each piece
// renders the extension's production component and wires it the way the extension's renderer setup does.

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

const SshPlatformContext = createContext<SshPlatform>()

function StoryPlatformProvider(props: ParentProps<{ value: Platform & { sshServers?: SshPlatform } }>) {
  return (
    <SshPlatformContext.Provider value={props.value.sshServers}>
      <PlatformProvider value={props.value}>{props.children}</PlatformProvider>
    </SshPlatformContext.Provider>
  )
}

const context = createSimpleContext({
  name: "Ssh",
  init: () => {
    const platform = useContext(SshPlatformContext)
    const language = useLanguage()
    const [servers, setServers] = createSignal<readonly SshItem[]>([])
    const refresh = () => platform?.getState().then((state) => setServers(state.servers)) ?? Promise.resolve()
    void refresh()
    const off = platform?.subscribe((state) => setServers(state.servers))
    if (off) onCleanup(off)
    const remote: RemoteClient<(typeof Ssh)["spec"]> | undefined = platform && {
      state: () => ({ servers: servers(), revision: 0 }),
      on: () => () => {},
      start: (input) => platform.start(input).then(() => 0),
      resolve: (input) => platform.resolve(input.id),
      respond: (input) => platform.respond(input.id, input.prompt, input.value),
      cancel: (input) => platform.cancel(input.id),
      forget: (input) => platform.forget(input.id),
    }
    return {
      get servers() {
        return servers()
      },
      ...createSshController({
        items: servers,
        api: () => remote,
        refresh,
        error: () => showToast({ variant: "error", title: language.t("common.requestFailed") }),
      }),
    }
  },
})

export const useSsh = () => context.use()

export function SshProvider(props: ParentProps) {
  return (
    <context.provider>
      <SshDialogs />
      {props.children}
    </context.provider>
  )
}

// Challenges of an attempt started without its dialog open one of their own.
function SshDialogs() {
  const ssh = useSsh()
  const dialog = useDialog()
  createEffect(() => {
    const item = ssh.dialog.next()
    if (!item || dialog.active) return
    ssh.dialog.opened(item.config.id)
    const config = item.config
    untrack(() => void dialog.push(() => <DialogSsh ssh={ssh} config={config} promptOnly />))
  })
  return null
}

function StoryDialogSsh(props: { config?: SshConfig; connect?: boolean }) {
  const ssh = useSsh()
  return <DialogSsh ssh={ssh} config={props.config} connect={props.connect} />
}

export function useSshAuthenticate() {
  const ssh = useSsh()
  return (server: ServerConnection.Any) => {
    if (server.type !== "extension" || server.extension !== "ssh" || !server.authenticationRequired) return false
    const item = ssh.item(server.key.slice("ssh:".length))
    if (!item) return false
    ssh.connect(item.config)
    return true
  }
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

// The home list shows an SSH server as the extension server the SSH extension contributes.
function StoryHomeProjectsView(
  props: Omit<HomeProjectsViewProps, "servers"> & { servers: StoryServerConnection.Ssh[] },
) {
  const servers = props.servers.map(
    (server): ServerConnection.Extension => ({
      type: "extension",
      key: StoryServerConnection.key(server),
      extension: "ssh",
      displayName: server.displayName,
      label: server.label,
      get state() {
        if (server.authenticationRequired) return "auth"
        return server.connecting ? "starting" : "ready"
      },
      get connecting() {
        return !!server.connecting
      },
      get authenticationRequired() {
        return !!server.authenticationRequired
      },
      managed: true,
      http: server.http,
    }),
  )
  return <HomeProjectsView {...props} servers={servers} />
}

// The cover reads `pending` from the same controller and reconnects through it, as the story's props do.
export function SshConnectionPanel(props: { item: SshItem; pending?: boolean; onReconnect: () => void }) {
  const ssh = useSsh()
  const offer: SshOffer = { selection: undefined, offered: false }
  return <SshCover id={props.item.config.id} tab={() => "story"} ssh={ssh} offer={offer} />
}

// Settings rows of saved SSH servers, with the parts the host passes to the extension's row.
export function SshServerSettings(props: { filter: string; id?: string; domain: ServerCollectionController }) {
  const ssh = useSsh()
  const ids = () =>
    ssh.servers
      .filter(
        (item) =>
          item.saved &&
          (!props.id || item.config.id === props.id) &&
          `${item.config.name} ${item.config.target}`.toLowerCase().includes(props.filter.toLowerCase()),
      )
      .map((item) => item.config.id)
  return (
    <For each={ids()}>
      {(id) => {
        const key = ServerConnection.Key.make(`ssh:${id}`)
        const row: ServerRow = {
          key,
          health: () => props.domain.collection.health()[key],
          Indicator: (indicator) => (
            <ServerHealthIndicator
              health={indicator.health}
              connecting={indicator.connecting}
              authenticationRequired={indicator.auth}
            />
          ),
          default: {
            available: () => props.domain.defaults.available(),
            current: () => props.domain.defaults.key() === key,
            set: (value) => void props.domain.defaults.set(value ? key : null),
          },
          remove: () => props.domain.connection.remove(key),
          Items: () => <SshRowItems id={id} />,
        }
        return <SshRow row={row} id={id} ssh={ssh} />
      }}
    </For>
  )
}

// The SSH extension's "server.row" menu items.
function SshRowItems(props: { id: string }) {
  const ssh = useSsh()
  const extension = useExtension()
  return (
    <Show when={ssh.item(props.id)}>
      {(item) => (
        <Show when={item().stage !== "ready"}>
          <Menu.Item disabled={ssh.pending(props.id)} onSelect={() => ssh.connect(item().config)}>
            {extension.t(item().stage === "authentication" ? "authenticate" : "connect")}
          </Menu.Item>
        </Show>
      )}
    </Show>
  )
}

export {
  StoryDialogSsh as DialogSsh,
  StoryHomeProjectsView as HomeProjectsView,
  StoryPlatformProvider as PlatformProvider,
  StoryServerConnection as ServerConnection,
}
