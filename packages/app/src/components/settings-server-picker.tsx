import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { createMemo, For, type Accessor, type ParentProps, Show } from "solid-js"
import { ServerHealthIndicator, ServerRow } from "@/components/server/server-row"
import { ModelsProvider } from "@/context/models"
import { ServerConnection } from "@/context/server"
import { ServerContextProvider } from "@/context/server-context"
import { useGlobal } from "@/context/global"
import { useSettings } from "@/context/settings"

export function SettingsServerScope(props: ParentProps<{ directory: Accessor<string | undefined> }>) {
  const global = useGlobal()
  const settings = useSettings()

  return (
    <Show when={settings.general.newLayoutDesigns()} fallback={props.children}>
      <Show when={global.settings.server.selected()}>
        {(server) => (
          <SettingsServerDataProviders server={server()} directory={props.directory}>
            {props.children}
          </SettingsServerDataProviders>
        )}
      </Show>
    </Show>
  )
}

function SettingsServerDataProviders(
  props: ParentProps<{ server: ServerConnection.Any; directory: Accessor<string | undefined> }>,
) {
  const global = useGlobal()
  const serverCtx = () => global.createServerCtx(props.server)

  return (
    <ServerContextProvider value={serverCtx}>
      <ModelsProvider directory={props.directory}>{props.children}</ModelsProvider>
    </ServerContextProvider>
  )
}

export function SettingsServerPicker() {
  const global = useGlobal()
  const settings = useSettings()
  const selected = createMemo(() =>
    settings.general.newLayoutDesigns() ? global.settings.server.selected() : undefined,
  )

  return (
    <Show when={selected()}>
      {(conn) => (
        <DropdownMenu gutter={4} placement="bottom-end">
          <DropdownMenu.Trigger
            as={Button}
            variant="secondary"
            size="large"
            class="h-8 max-w-[260px] gap-2 px-2 py-1.5 data-[expanded]:bg-surface-base-active"
          >
            <ServerHealthIndicator health={global.servers.health[ServerConnection.key(conn())]} />
            <ServerRow
              conn={conn()}
              status={global.servers.health[ServerConnection.key(conn())]}
              class="flex items-center gap-2 min-w-0 flex-1"
              nameClass="text-14-regular text-text-base truncate"
              versionClass="hidden"
            />
            <Icon name="chevron-down" size="small" class="text-icon-weak shrink-0" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="w-[320px] mt-1 [&_[data-slot=dropdown-menu-radio-item]]:pl-2 [&_[data-slot=dropdown-menu-radio-item]]:pr-2">
              <DropdownMenu.RadioGroup
                value={global.settings.server.key}
                onChange={(key) => {
                  if (typeof key === "string") global.settings.server.set(ServerConnection.Key.make(key))
                }}
              >
                <For each={global.servers.list()}>
                  {(item) => {
                    const key = ServerConnection.key(item)
                    const blocked = () => global.servers.health[key]?.healthy === false
                    return (
                      <DropdownMenu.RadioItem value={key} disabled={blocked()}>
                        <ServerHealthIndicator health={global.servers.health[key]} />
                        <ServerRow
                          conn={item}
                          dimmed={blocked()}
                          status={global.servers.health[key]}
                          class="flex items-center gap-2 min-w-0 flex-1"
                          nameClass="text-14-regular text-text-base truncate"
                          versionClass="text-12-regular text-text-weak truncate"
                        />
                        <DropdownMenu.ItemIndicator>
                          <Icon name="check-small" size="small" class="text-icon-weak" />
                        </DropdownMenu.ItemIndicator>
                      </DropdownMenu.RadioItem>
                    )
                  }}
                </For>
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      )}
    </Show>
  )
}
