import { Show, type Component } from "solid-js"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { useGlobal } from "@/context/global"
import { ServerConnection, serverName } from "@/context/server"

export const InlineServerSelect: Component = () => {
  const global = useGlobal()

  return (
    <Show when={global.servers.list().length > 1}>
      <SelectV2
        appearance="inline"
        data-action="settings-server-select"
        options={global.servers.list()}
        current={global.settings.server.selected()}
        value={ServerConnection.key}
        label={(server) => serverName(server) || ServerConnection.key(server)}
        optionDisabled={(server) => global.servers.health[ServerConnection.key(server)]?.healthy === false}
        placement="bottom-end"
        gutter={6}
        onSelect={(server) => {
          if (server) global.settings.server.set(ServerConnection.key(server))
        }}
      />
    </Show>
  )
}
