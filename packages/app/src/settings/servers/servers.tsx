import { Badge } from "@opencode/ui/badge"
import { useDialog } from "@opencode/ui/context/dialog"
import { createMemo, Show, untrack, type Component } from "solid-js"
import type { ServerRow } from "@opencode/gui-extensions/sdk"
import { ServerRowMenu } from "@/servers/registry/row-menu"
import { ServerHealthIndicator } from "@/servers/registry/row"
import { ServerRowItems } from "@/servers/registry/row-items"
import { AddServerMenu } from "@/servers/registry/add-menu"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, serverName } from "@/runtime/server/registry"
import { useServerCollectionController, type ServerCollectionController } from "@/servers/registry/controller"
import { DialogServer } from "@/servers/connect/dialog"
import { Contribution } from "@/runtime/extension/render"
import { useExtensionServers } from "@/runtime/extension/servers"
import { SettingsList } from "@/settings/list"
import { ShellSetting } from "@/settings/general/general"
import { createServerShellController } from "@/settings/general/controllers"
import type { SettingsServer } from "./inventory"
import "@/settings/settings.css"

export const SettingsServerGeneral: Component<{
  entry: SettingsServer
  nested?: boolean
  onAddServer?: () => void
  onServerChange?: (server: ServerConnection.Any) => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const controller = useServerCollectionController()
  const health = createMemo(() => controller.collection.health()[props.entry.key])
  const edit = (server: ServerConnection.Http) =>
    void dialog.push(() => <DialogServer mode="edit" server={server} onSave={props.onServerChange} />)

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">
              {props.nested ? props.entry.name : language.t("settings.section.server")}
            </h2>
            <span class="text-11-regular text-v2-text-text-muted">
              {language.t(props.nested ? "settings.server.description" : "settings.servers.description")}
            </span>
          </div>
          <Show when={!props.nested && props.onAddServer}>
            <AddServerMenu onAddServer={() => props.onAddServer?.()} />
          </Show>
        </div>
      </div>

      <div class="settings-tab-body settings-tab-body--sectioned">
        <section class="settings-section settings-server-connection" data-component="settings-server-connection">
          <h3 class="settings-section-title">{language.t("settings.server.section.connection")}</h3>
          <SettingsList>
            <Show
              when={props.entry.source?.entry.row ? props.entry.key : undefined}
              keyed
              fallback={
                <Show when={props.entry.connection}>
                  {(server) => (
                    <div class="settings-servers-row">
                      <div class="settings-servers-lead">
                        <ServerHealthIndicator health={health()} />
                        <div class="settings-servers-copy">
                          <bdi class="settings-servers-name" dir="auto">
                            {serverName(server()) || props.entry.key}
                          </bdi>
                          <bdi class="settings-servers-meta" dir="ltr">
                            {server().http.url}
                          </bdi>
                        </div>
                      </div>
                      <div class="settings-servers-actions">
                        <Show when={controller.defaults.available() && controller.defaults.key() === props.entry.key}>
                          <Badge>{language.t("dialog.server.status.default")}</Badge>
                        </Show>
                        <ServerRowMenu server={server()} domain={controller} onEdit={edit} />
                      </div>
                    </div>
                  )}
                </Show>
              }
            >
              {(key) => <ExtensionServerRow server={key} controller={controller} />}
            </Show>
          </SettingsList>
        </section>

        <Show when={props.entry.connection} keyed>
          {(server) => <ServerShell server={server} />}
        </Show>
      </div>
    </>
  )
}

/** A contributed server's connection row; the extension renders it with the host's shared parts. */
function ExtensionServerRow(props: { server: ServerConnection.Key; controller: ServerCollectionController }) {
  const servers = useExtensionServers()
  // The entry changes with every state update; its row follows the extension's state on its own.
  const source = untrack(() => servers.entry(props.server))
  const row: ServerRow = {
    key: props.server,
    health: () => props.controller.collection.health()[props.server],
    Indicator: (indicator) => (
      <ServerHealthIndicator
        health={indicator.health}
        connecting={indicator.connecting}
        authenticationRequired={indicator.auth}
      />
    ),
    default: {
      available: () => props.controller.defaults.available(),
      current: () => props.controller.defaults.key() === props.server,
      set: (value) => void props.controller.defaults.set(value ? props.server : null),
    },
    remove: () => props.controller.connection.remove(props.server),
    Items: () => <ServerRowItems server={props.server} />,
  }
  if (!source) return null
  return <Contribution extension={source.extension}>{() => untrack(() => source.entry.row?.(row))}</Contribution>
}

function ServerShell(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
  const controller = createServerShellController(() => props.server)
  return (
    <section class="settings-section">
      <h3 class="settings-section-title">{language.t("settings.tab.preferences")}</h3>
      <SettingsList>
        <ShellSetting controller={controller} />
      </SettingsList>
    </section>
  )
}
