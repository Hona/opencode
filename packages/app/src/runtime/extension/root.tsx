import { createMemo, createResource, lazy, onCleanup, Show, Suspense, type ParentProps } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { Installed } from "@opencode/gui-extensions/sdk/bridge"
import { builtins } from "./builtins"
import { createMenubar, ExtensionMenubarProvider } from "./menubar"
import { usePlatform } from "@/runtime/platform/platform"
import { ExtensionHostProvider, useExtensionHost } from "./host"
import { createRemotes } from "./remote"
import { createExtensionAttachment, createExtensionServices, ExtensionAttachmentProvider, type ExtensionServices } from "./services"
import { ExtensionCommands } from "./commands"
import { ExtensionStyles } from "./render"
import { ExtensionServersProvider } from "./servers"
import { ExtensionServerEndpoints } from "./server-shell"
import { createContext, useContext } from "solid-js"

const ServicesContext = createContext<ExtensionServices>()
const ExtensionHotReload = import.meta.env.DEV ? lazy(() => import("./hmr")) : undefined

export function useExtensionServices() {
  const value = useContext(ServicesContext)
  if (!value) throw new Error("Extension services are unavailable")
  return value
}

/** Mounts the extension host for the window. Lives above the app interface so extensions can contribute servers. */
export function ExtensionRoot(props: ParentProps) {
  const platform = usePlatform()
  const services = createExtensionServices()
  const bridge = platform.extensions
  const menubar = createMenubar(bridge)
  const remotes = createRemotes(bridge)
  const [installed, setInstalled] = createStore({ list: [] as Installed[] })
  const [loaded] = createResource(async () => {
    if (!bridge) return true
    setInstalled("list", reconcile([...(await bridge.manager.list())]))
    return true
  })
  if (bridge) onCleanup(bridge.on((message) => message.type === "extensions" && setInstalled("list", reconcile([...message.list]))))
  const disabled = createMemo(() =>
    loaded() ? new Set(installed.list.filter((item) => !item.enabled).map((item) => item.id)) : undefined,
  )
  const os = platform.platform === "desktop" ? platform.os : undefined
  const definitions = builtins.filter((definition) => !definition.os || (!!os && definition.os.includes(os)))
  return (
    <ServicesContext.Provider value={services}>
        <ExtensionHostProvider
          definitions={definitions}
          disabled={disabled}
          services={services.services}
          remote={(token) => remotes.client(token)}
        >
          <ExtensionStyles />
          {ExtensionHotReload && (
            <Suspense>
              <ExtensionHotReload />
            </Suspense>
          )}
          <ExtensionMenubarProvider value={menubar}>
            <ExtensionServersProvider
              failed={(id) => installed.list.some((item) => item.id === id && item.error !== undefined)}
            >
              {props.children}
            </ExtensionServersProvider>
          </ExtensionMenubarProvider>
        </ExtensionHostProvider>
    </ServicesContext.Provider>
  )
}

/** Attaches session and layout services and publishes extension commands. Renders once extensions are active. */
export function ExtensionAttachment(props: ParentProps) {
  const host = useExtensionHost()
  const attachment = createExtensionAttachment(useExtensionServices())
  return (
    <ExtensionAttachmentProvider value={attachment}>
      <ExtensionCommands />
      <ExtensionServerEndpoints />
      <Show when={host.ready()}>{props.children}</Show>
    </ExtensionAttachmentProvider>
  )
}
