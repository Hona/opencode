import { createMemo } from "solid-js"
import { Command } from "@opencode/plugin/gui"
import { useCommand } from "@/shell/commands/command"
import { useSettings } from "@/settings/model"
import { migrateKeybinds } from "@/settings/keybinds/migration"
import { usePluginHost } from "./host"

/** Publishes plugin commands as `${plugin}.${id}` in the host command registry. */
export function PluginCommands() {
  const host = usePluginHost()
  const command = useCommand()
  migrateKeybinds(useSettings())
  // Plugins activate in whatever order their entries load; list them in definition order, then registration order.
  const rank = createMemo(() => new Map(host.definitions().map((definition, index) => [definition.id, index])))
  const order = (plugin: string) => rank().get(plugin) ?? rank().size
  command.register("plugins", () =>
    host
      .items(Command)
      .toSorted((a, b) => order(a.plugin) - order(b.plugin))
      .map((item) => ({
        id: `${item.plugin}.${item.value.id}`,
        title: item.value.title,
        description: item.value.description,
        category: item.value.group,
        section: item.value.section,
        keybind: item.value.bind,
        slash: item.value.slash?.name,
        slashArguments: item.value.slash?.arguments,
        slashAfter: item.value.slash?.after,
        suggested: item.value.suggested,
        featured: item.value.featured,
        disabled: item.value.enabled === false,
        hidden: item.value.hidden,
        editable: item.value.editable,
        when: whenScoped(item.value.scope),
        onSelect: (_source: "palette" | "keybind" | "slash" | undefined, input?: string) => item.value.run(input),
      })),
  )

  return null
}

// A command scoped to a selector runs only while the event's target is inside it.
const whenScoped = (scope: string | undefined) =>
  scope ? (event: KeyboardEvent) => event.target instanceof Element && !!event.target.closest(scope) : undefined
