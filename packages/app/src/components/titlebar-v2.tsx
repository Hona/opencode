import { createMemo, For, Show } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { ProjectAvatar } from "@opencode-ai/ui/v2/project-avatar-v2"
import { getProjectAvatarVariant, type LocalProject } from "@/context/layout"
import { useGlobal } from "@/context/global"
import { ServerConnection } from "@/context/server"
import { useAppRoute } from "@/context/route"
import { useTabs } from "@/context/tabs"
import { displayName, getProjectAvatarSource, projectForSession } from "@/pages/layout/helpers"
import { useSessionTabAvatarState } from "@/pages/layout/project-avatar-state"
import { WindowsAppMenu } from "./windows-app-menu"
import { ChannelIndicator, TITLEBAR_DRAG_CLASS, TITLEBAR_PORTAL_ID, useTitlebarRuntime } from "./titlebar-shared"
import { sessionQuery } from "@/utils/v2-route"

const titlebarHeight = 36

export function TitlebarV2() {
  const route = useAppRoute()
  const tabs = useTabs()
  const titlebar = useTitlebarRuntime(titlebarHeight)
  const activeTab = () => {
    const current = route()
    if (current.type === "draft") return tabs.tabs.find((tab) => tab.type === "draft" && tab.draftID === current.draftID)
    if (current.type !== "session") return
    return tabs.tabs.find(
      (tab) => tab.type === "session" && tab.server === current.server && tab.sessionId === current.tabID,
    )
  }
  const placement = () => {
    const current = route()
    if (current.type === "session" || current.type === "draft") {
      return { server: current.server, directory: current.directory }
    }
  }
  const openNewTab = () => {
    const current = placement()
    if (!current) return
    tabs.newDraft(current)
  }

  titlebar.command.register("tabs", () => {
    const current = activeTab()
    return [
      {
        id: "tab.new",
        category: "tab",
        title: titlebar.language.t("command.session.new"),
        keybind: "mod+t",
        hidden: true,
        onSelect: openNewTab,
      },
      current && {
        id: "tab.close",
        category: "tab",
        title: titlebar.language.t("command.tab.close"),
        keybind: "mod+w",
        hidden: true,
        onSelect: () => tabs.close(current, true),
      },
      {
        id: `tab.prev`,
        category: "tab",
        title: "",
        keybind: `mod+option+ArrowLeft`,
        hidden: true,
        onSelect: () => {
          const current = activeTab()
          if (current) tabs.previous(current)
        },
      },
      {
        id: `tab.next`,
        category: "tab",
        title: "",
        keybind: `mod+option+ArrowRight`,
        hidden: true,
        onSelect: () => {
          const current = activeTab()
          if (current) tabs.next(current)
        },
      },
      ...Array.from({ length: 9 }, (_, index) => {
        const number = index + 1
        return {
          id: `tab.${number}`,
          category: "tab",
          title: "",
          keybind: `mod+${number}`,
          disabled: tabs.tabs.length <= index,
          hidden: true,
          onSelect: () => tabs.select(index),
        }
      }),
    ].filter((value) => value !== undefined)
  })

  return (
    <header
      class={`shrink-0 relative flex flex-row h-9 bg-v2-background-bg-deep overflow-visible ${TITLEBAR_DRAG_CLASS}`}
      style={{
        "min-height": titlebar.minHeight(),
        "padding-left": titlebar.mac() ? `${84 / titlebar.zoom()}px` : 0,
        width: titlebar.windows()
          ? `env(titlebar-area-width, calc(100vw - ${titlebar.windowsControlsWidth()}))`
          : undefined,
        "max-width": titlebar.windows()
          ? `env(titlebar-area-width, calc(100vw - ${titlebar.windowsControlsWidth()}))`
          : undefined,
        "align-self": titlebar.windows() ? "flex-start" : undefined,
      }}
    >
      <div
        class="h-full flex-1 flex flex-row items-center gap-1.5 pr-3 pt-2"
        classList={{
          "pl-2": titlebar.mac(),
          "pl-4": !titlebar.mac(),
        }}
      >
        <ChannelIndicator />
        <Show when={titlebar.windows() || titlebar.linux()}>
          <WindowsAppMenu command={titlebar.command} platform={titlebar.platform} variant="v2" />
        </Show>
        <IconButtonV2
          variant="ghost-muted"
          size="large"
          as="a"
          href="/"
          class="!w-9"
          icon={<IconV2 name="grid-plus" />}
          state={route().type === "home" ? "pressed" : undefined}
        />

        <div class="flex min-w-0 flex-1 flex-row items-center gap-1.5 overflow-hidden">
          <div class="flex min-w-0 flex-row items-center gap-1.5 overflow-hidden">
            <For each={tabs.tabs}>
              {(tab, index) => (
                <>
                  {index() !== 0 && (
                    <div class="w-[1.5px] h-3 shrink-0 rounded-full bg-[var(--v2-background-bg-layer-02)]" />
                  )}
                  {tab.type === "session" ? (
                    <TabNavItem
                      href={tabs.href(tab)}
                      server={tab.server}
                      sessionId={tab.sessionId}
                      onSelect={() => tabs.select(index())}
                      onClose={() => tabs.close(tab, activeTab() === tab)}
                      active={activeTab() === tab}
                    />
                  ) : (
                    <NewSessionTabItem
                      href={tabs.href(tab)}
                      title={titlebar.language.t("command.session.new")}
                      onSelect={() => tabs.select(index())}
                      onClose={() => tabs.close(tab, activeTab() === tab)}
                      active={activeTab() === tab}
                    />
                  )}
                </>
              )}
            </For>
          </div>
          <Show when={placement()}>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="large"
              class="shrink-0"
              icon={<IconV2 name="plus" />}
              onClick={openNewTab}
              aria-label={titlebar.language.t("command.session.new")}
            />
          </Show>
          <div class="min-w-0 flex-1" />
        </div>
        <div class="relative z-20 flex shrink-0 items-center justify-end gap-0 overflow-visible">
          <div id={TITLEBAR_PORTAL_ID.right} class="flex shrink-0 items-center justify-end gap-0" />
        </div>
      </div>
    </header>
  )
}

function TabNavItem(props: {
  href: string
  server: ServerConnection.Key
  sessionId: string
  onSelect: () => void
  onClose: () => void
  active?: boolean
}) {
  const global = useGlobal()
  const closeTab = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    props.onClose()
  }
  const server = createMemo(() => global.servers.get(props.server))
  const session = useQuery(() => sessionQuery(props.server, server().instance, server().sdk, props.sessionId))

  return (
    <div
      class="group relative flex h-7 min-w-24 max-w-60 flex-row items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[6px] bg-[var(--tab-bg)] px-1.5 [--tab-bg:var(--v2-background-bg-deep)] hover:[--tab-bg:var(--v2-background-bg-layer-02)] data-[active='true']:[--tab-bg:var(--v2-background-bg-layer-02)]"
      data-active={props.active}
      onMouseDown={(event) => {
        if (event.button !== 1) return
        closeTab(event)
      }}
    >
      <Show when={session.data}>
        {(locator) => {
          const project = createMemo(() => projectForSession(locator().session, server().projects.list()))
          return (
            <a
              href={props.href}
              onClick={(event) => {
                event.preventDefault()
                props.onSelect()
              }}
              class="flex h-full min-w-0 flex-1 flex-row items-center gap-1.5 text-[13px] font-medium text-v2-text-text-faint group-data-[active='true']:text-v2-text-text-base"
            >
              <span data-slot="project-avatar-slot">
                <ProjectTabAvatar
                  project={project()}
                  directory={locator().session.directory}
                  sessionId={locator().session.id}
                  server={props.server}
                />
              </span>
              <span class="min-w-0 flex-1">{locator().session.title}</span>
            </a>
          )
        }}
      </Show>

      <div class="absolute not-group-hover:not-group-data-[active=true]:left-52 group-hover:right-0 group-data-[active=true]:right-0 inset-y-0 flex flex-row items-center pr-1 py-1 w-8 pl-2">
        <div
          class="absolute inset-0 rounded-r-[6px] bg-(image:--inactive-bg) group-hover:bg-(image:--active-bg) group-data-[active=true]:bg-(image:--active-bg)"
          style={{
            "--inactive-bg": "linear-gradient(to right, transparent 0%, var(--tab-bg) 80%)",
            "--active-bg": "linear-gradient(90deg, transparent 0%, var(--tab-bg) 25%)",
          }}
        />
        <IconButtonV2
          size="small"
          variant="ghost-muted"
          class="opacity-0 group-hover:opacity-100 group-data-[active='true']:opacity-100 z-10"
          onClick={closeTab}
          icon={<IconV2 name="xmark-small" />}
        />
      </div>
    </div>
  )
}

function ProjectTabAvatar(props: {
  project?: LocalProject
  server: ServerConnection.Key
  directory: string
  sessionId: string
}) {
  const state = useSessionTabAvatarState(
    () => props.server,
    () => props.directory,
    () => props.sessionId,
  )
  return (
    <ProjectAvatar
      fallback={displayName(props.project ?? { worktree: props.directory })}
      src={getProjectAvatarSource(props.project?.id, props.project?.icon)}
      variant={getProjectAvatarVariant(props.project?.icon?.color)}
      unread={state.unread()}
      loading={state.loading()}
    />
  )
}

function NewSessionTabItem(props: {
  href: string
  title: string
  onSelect: () => void
  onClose: () => void
  active: boolean
}) {
  const closeTab = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    props.onClose()
  }
  return (
    <div
      class="group relative flex h-7 max-w-60 flex-row items-center gap-1.5 overflow-hidden rounded-[6px] pl-1.5 pr-8 whitespace-nowrap focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--v2-border-border-focus)] data-[active=true]:bg-[var(--v2-overlay-simple-overlay-pressed)]"
      data-active={props.active}
      onMouseDown={(event) => {
        if (event.button !== 1) return
        closeTab(event)
      }}
    >
      <a
        href={props.href}
        onClick={(event) => {
          event.preventDefault()
          props.onSelect()
        }}
        aria-current={props.active ? "page" : undefined}
        class="flex h-full min-w-0 flex-1 flex-row items-center gap-1.5 overflow-hidden text-[13px] font-medium leading-5 text-[var(--v2-text-text-base)]"
      >
        <span class="flex size-4 shrink-0 rotate-90 items-center justify-center">
          <IconV2 name="edit" />
        </span>
        <span class="truncate leading-5">{props.title}</span>
      </a>
      <div class="absolute right-0 inset-y-0 flex w-7 items-center justify-center">
        <IconButtonV2
          size="small"
          variant="ghost-muted"
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={closeTab}
          icon={<IconV2 name="xmark-small" />}
          aria-label="Close tab"
        />
      </div>
    </div>
  )
}
