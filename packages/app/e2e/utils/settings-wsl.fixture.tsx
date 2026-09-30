import { MemoryRouter, createMemoryHistory } from "@solidjs/router"
import { createMemo, Show } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
import { render } from "solid-js/web"
import type { Bridge, BridgeMessage } from "@opencode/gui-extensions/sdk/bridge"
import type { WslServersState } from "../../../gui-extensions/src/wsl/contract"
import { AppBaseProviders, AppInterface } from "../../src/app"
import { PlatformProvider, type Platform } from "../../src/runtime/platform/platform"
import { ServerConnection } from "../../src/runtime/server/registry"
import { useExtensionServers } from "../../src/runtime/extension/servers"

export function mount(input: { server: string; mode: "failed" | "stopped" | "ready" }) {
  const root = document.getElementById("root")
  if (!root) throw new Error("Missing fixture root")
  const history = createMemoryHistory()
  history.set({ value: "/settings", replace: true, scroll: false })
  render(() => {
    const [store, setStore] = createStore<{ calls: string[]; state: WslServersState }>({
      calls: [],
      state: {
        runtime: { available: true, version: "2", error: null },
        installed: [],
        online: [],
        distroProbes: {},
        pendingRestart: false,
        job: null,
        servers: [
          {
            config: { id: "wsl:Ubuntu", distro: "Ubuntu" },
            runtime:
              input.mode === "ready"
                ? { kind: "ready", url: input.server, password: null }
                : input.mode === "failed"
                  ? { kind: "failed", message: "WSL failed to start" }
                  : { kind: "stopped" },
          },
        ],
        opencodeChecks: {
          Ubuntu: {
            distro: "Ubuntu",
            resolvedPath: "/usr/bin/opencode",
            version: "old",
            expectedVersion: "current",
            matchesDesktop: false,
            error: null,
          },
        },
      },
    })
    // The main-process WSL and SSH extensions, as the extension bridge sees them.
    const listeners = new Set<(message: BridgeMessage) => void>()
    const snapshot = () => structuredClone(unwrap(store.state))
    const publish = () => listeners.forEach((listener) => listener({ type: "state", remote: "wsl", state: snapshot() }))
    const methods: Record<string, (input: { id?: string; name?: string }) => void> = {
      installOpencode(value) {
        setStore("calls", (calls) => [...calls, `update:${value.name}`])
        setStore("state", "opencodeChecks", value.name ?? "", { version: "current", matchesDesktop: true })
      },
      startServer(value) {
        setStore("calls", (calls) => [...calls, `start:${value.id}`])
        setStore("state", "servers", (server) => server.config.id === value.id, "runtime", {
          kind: "ready",
          url: input.server,
          password: null,
        })
      },
      removeServer(value) {
        setStore("calls", (calls) => [...calls, `remove:${value.id}`])
        setStore("state", "servers", (servers) => servers.filter((server) => server.config.id !== value.id))
      },
    }
    const bridge: Bridge = {
      async call(request) {
        const method = request.remote === "wsl" ? methods[request.method] : undefined
        if (!method) throw new Error("Unexpected fixture action")
        method(request.input as { id?: string; name?: string })
        publish()
        return null
      },
      async subscribe(remote) {
        if (remote === "wsl") return { available: true, state: snapshot() }
        if (remote === "ssh") return { available: true, state: { servers: [], revision: 0 } }
        return { available: false }
      },
      on(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      surface: () => undefined,
      capture: async () => undefined,
      menubar: () => undefined,
      configure: () => undefined,
      manager: {
        list: async () => [],
        enable: async () => undefined,
        disable: async () => undefined,
        reload: async () => undefined,
        install: async () => undefined,
        remove: async () => undefined,
        source: async () => "",
        asset: () => "",
      },
    }
    const unused = async () => {
      throw new Error("Unexpected fixture action")
    }
    const platform: Platform = {
      platform: "desktop",
      os: "windows",
      windowID: "settings-wsl-test",
      openExternal: () => undefined,
      openDirectoryPickerDialog: async () => null,
      notify: async () => undefined,
      restart: unused,
      extensions: bridge,
    }
    function Interface() {
      const extensions = useExtensionServers()
      const servers = createMemo<ServerConnection.Any[]>(() => [
        { type: "sidecar", variant: "base", displayName: "Local Server", http: { url: input.server } },
        ...extensions.list(),
      ])
      return (
        <Show when={extensions.ready()}>
          <AppInterface
            servers={servers()}
            defaultServer={ServerConnection.Key.make("sidecar")}
            router={(props) => <MemoryRouter {...props} history={history} />}
          />
        </Show>
      )
    }
    return (
      <PlatformProvider value={platform}>
        <AppBaseProviders locale="en">
          <output aria-label="WSL actions">{store.calls.join(",")}</output>
          <Interface />
        </AppBaseProviders>
      </PlatformProvider>
    )
  }, root)
}
