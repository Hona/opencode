import type { BackgroundTask } from "@opencode/gui-extensions/sdk"
import { taskAgent } from "@opencode/session-ui/agent-tone"
import { useData } from "@opencode/session-ui/context"
import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { createMemo, For, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useServer } from "@/runtime/server/current"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"

type RunningItem = {
  key: string
  type: "subagent" | "shell"
  label?: string
  agent?: string
  sessionID?: string
  target: string
}

export function SessionRunningMenu(props: {
  blocking: readonly { type: "shell" | "subagent"; partID: string; id?: string; label?: string; agent?: string }[]
  tasks: readonly BackgroundTask[]
  onReveal: (target: string) => void
}) {
  const language = useLanguage()
  const data = useData()
  const server = useServer()
  const sdk = useServerSDK()

  // Foreground shells stay out: the timeline already shows them at the bottom.
  const items = createMemo<RunningItem[]>(() => [
    ...props.blocking.flatMap((task) =>
      task.type === "subagent"
        ? [{ ...task, key: task.id ?? task.partID, sessionID: task.id, target: task.partID }]
        : [],
    ),
    ...props.tasks
      .filter((task) => task.type === "subagent")
      .map((task) => ({ ...task, key: task.id, sessionID: task.id, target: task.id })),
    ...props.tasks.filter((task) => task.type === "shell").map((task) => ({ ...task, key: task.id, target: task.id })),
  ])

  const label = createMemo(() => {
    const count = items().length

    if (items().some((item) => item.type === "shell")) return language.plural("session.running.running", count)

    return language.plural("session.running.working", count)
  })

  const open = (item: RunningItem) => {
    if (item.sessionID && data.navigateToSession) {
      data.navigateToSession(item.sessionID)

      return
    }

    props.onReveal(item.target)
  }

  // A subagent can only be interrupted once its child session exists.
  const stoppable = (item: RunningItem) => item.type === "shell" || !!item.sessionID

  const stop = (item: RunningItem) => {
    const request = item.sessionID
      ? sdk.api.session.interrupt({ sessionID: item.sessionID })
      : sdk.api.shell.remove({
          id: item.target,
          location: { directory: server.ctx.data.shell.get(item.target)?.location.directory },
        })

    void request.catch((error) =>
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(error, language.t("common.requestFailed")),
      }),
    )
  }

  return (
    <Show when={items().length > 0}>
      <Menu gutter={4} placement="bottom-start">
        <Menu.Trigger
          as="button"
          type="button"
          aria-label={label()}
          class="flex h-7 shrink-0 items-center rounded-[6px] px-2 text-[13px] font-[530] leading-text-compact tracking-[-0.04px] whitespace-nowrap text-v2-text-text-base outline-none hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus data-[expanded]:bg-v2-overlay-simple-overlay-hover"
        >
          <TextShimmer text={label()} active />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content class="w-60" aria-label={label()}>
            <For each={items()}>
              {(item) => {
                const agent = createMemo(() => taskAgent(item.agent, data.store.agent))

                return (
                  <Menu.Item
                    class="group/running-item"
                    onSelect={() => open(item)}
                    onKeyDown={(event) => {
                      if ((event.key !== "Delete" && event.key !== "Backspace") || !stoppable(item)) return

                      event.preventDefault()
                      stop(item)
                    }}
                  >
                    <Show
                      when={item.type === "subagent"}
                      fallback={<Icon name="console" class="shrink-0 text-v2-icon-icon-muted" />}
                    >
                      <SessionProgressIndicatorV2
                        class="shrink-0"
                        style={{ color: agent().v2Color ?? "light-dark(var(--v2-text-text-base), #ffffff)" }}
                      />
                    </Show>
                    <span class="shrink-0 font-[530]">
                      {item.type === "shell"
                        ? language.t("ui.tool.shell")
                        : (agent().name ?? language.t("ui.tool.agent.default"))}
                    </span>
                    <span dir="auto" class="min-w-0 flex-1 truncate text-v2-text-text-muted">
                      {item.label}
                    </span>
                    <Show when={stoppable(item)}>
                      {/* The button's own display rule outranks utilities, so this wrapper shows and hides it. */}
                      <span class="hidden shrink-0 group-hover/running-item:flex group-data-[highlighted]/running-item:flex [@media(hover:none)]:flex">
                        {/* The row selects on press, so the stop button keeps its pointer events to itself. */}
                        <IconButton
                          type="button"
                          size="small"
                          variant="ghost-muted"
                          tabIndex={-1}
                          icon={<Icon name="outline-xmark" />}
                          aria-label={language.t(
                            item.type === "shell" ? "session.running.stop.shell" : "session.running.stop.subagent",
                          )}
                          onPointerDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                          }}
                          onPointerUp={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            stop(item)
                          }}
                        />
                      </span>
                    </Show>
                  </Menu.Item>
                )
              }}
            </For>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
    </Show>
  )
}
