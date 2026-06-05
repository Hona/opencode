import { createMemo, Show } from "solid-js"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { useLayout } from "@/context/layout"
import { WindowsAppMenu } from "./windows-app-menu"
import { ChannelIndicator, TITLEBAR_DRAG_CLASS, TITLEBAR_PORTAL_ID, useTitlebarRuntime } from "./titlebar-shared"

const titlebarHeight = 40

export function Titlebar() {
  const layout = useLayout()
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams<{ dir?: string; id?: string }>()
  const titlebar = useTitlebarRuntime(titlebarHeight)
  const creating = createMemo(() => {
    if (!params.dir) return false
    if (params.id) return false
    const parts = location.pathname.replace(/\/+$/, "").split("/")
    return parts.at(-1) === "session"
  })
  const hasProjects = createMemo(() => layout.projects.list().length > 0)

  return (
    <header
      class={`shrink-0 relative flex flex-row h-10 bg-background-base overflow-hidden ${TITLEBAR_DRAG_CLASS}`}
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
        class="grid h-full min-h-full w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center"
        style={{ zoom: titlebar.counterZoom() }}
      >
        <div
          classList={{
            "flex items-center min-w-0": true,
            "pl-2": !titlebar.mac(),
          }}
        >
          <Show when={titlebar.windows() || titlebar.linux()}>
            <WindowsAppMenu command={titlebar.command} platform={titlebar.platform} />
          </Show>
          <Show when={titlebar.mac()}>
            <div class="xl:hidden w-10 shrink-0 flex items-center justify-center">
              <IconButton
                icon="menu"
                variant="ghost"
                class="titlebar-icon rounded-md"
                onClick={layout.mobileSidebar.toggle}
                aria-label={titlebar.language.t("sidebar.menu.toggle")}
                aria-expanded={layout.mobileSidebar.opened()}
              />
            </div>
          </Show>
          <Show when={!titlebar.mac()}>
            <div class="xl:hidden w-[48px] shrink-0 flex items-center justify-center">
              <IconButton
                icon="menu"
                variant="ghost"
                class="titlebar-icon rounded-md"
                onClick={layout.mobileSidebar.toggle}
                aria-label={titlebar.language.t("sidebar.menu.toggle")}
                aria-expanded={layout.mobileSidebar.opened()}
              />
            </div>
          </Show>
          <div class="flex items-center gap-1 shrink-0">
            <TooltipKeybind
              class={titlebar.web() ? "hidden xl:flex shrink-0 ml-14" : "hidden xl:flex shrink-0 ml-2"}
              placement="bottom"
              title={titlebar.language.t("command.sidebar.toggle")}
              keybind={titlebar.command.keybind("sidebar.toggle")}
            >
              <Button
                variant="ghost"
                class="group/sidebar-toggle titlebar-icon w-8 h-6 p-0 box-border"
                onClick={layout.sidebar.toggle}
                aria-label={titlebar.language.t("command.sidebar.toggle")}
                aria-expanded={layout.sidebar.opened()}
              >
                <Icon size="small" name={layout.sidebar.opened() ? "sidebar-active" : "sidebar"} />
              </Button>
            </TooltipKeybind>
            <div class="hidden xl:flex items-center shrink-0">
              <Show when={params.dir}>
                <div
                  class="flex items-center shrink-0 w-8 mr-1"
                  aria-hidden={layout.sidebar.opened() ? "true" : undefined}
                >
                  <div
                    class="transition-opacity"
                    classList={{
                      "opacity-100 duration-120 ease-out": !layout.sidebar.opened(),
                      "opacity-0 duration-120 ease-in delay-0 pointer-events-none": layout.sidebar.opened(),
                    }}
                  >
                    <TooltipKeybind
                      placement="bottom"
                      title={titlebar.language.t("command.session.new")}
                      keybind={titlebar.command.keybind("session.new")}
                      openDelay={2000}
                    >
                      <Button
                        variant="ghost"
                        icon={creating() ? "new-session-active" : "new-session"}
                        class="titlebar-icon w-8 h-6 p-0 box-border"
                        disabled={layout.sidebar.opened()}
                        tabIndex={layout.sidebar.opened() ? -1 : undefined}
                        onClick={() => {
                          if (!params.dir) return
                          navigate(`/${params.dir}/session`)
                        }}
                        aria-label={titlebar.language.t("command.session.new")}
                        aria-current={creating() ? "page" : undefined}
                      />
                    </TooltipKeybind>
                  </div>
                </div>
              </Show>
              <div
                class="flex items-center shrink-0"
                classList={{
                  "-translate-x-[36px]": layout.sidebar.opened() && !!params.dir,
                  "duration-180 ease-out": !layout.sidebar.opened(),
                  "duration-180 ease-in": layout.sidebar.opened(),
                }}
              >
                <Show when={hasProjects()}>
                  <div class="flex items-center gap-0 transition-transform">
                    <Tooltip placement="bottom" value={titlebar.language.t("common.goBack")} openDelay={2000}>
                      <Button
                        variant="ghost"
                        icon="chevron-left"
                        class="titlebar-icon w-6 h-6 p-0 box-border"
                        disabled={!titlebar.canBack()}
                        onClick={titlebar.back}
                        aria-label={titlebar.language.t("common.goBack")}
                      />
                    </Tooltip>
                    <Tooltip placement="bottom" value={titlebar.language.t("common.goForward")} openDelay={2000}>
                      <Button
                        variant="ghost"
                        icon="chevron-right"
                        class="titlebar-icon w-6 h-6 p-0 box-border"
                        disabled={!titlebar.canForward()}
                        onClick={titlebar.forward}
                        aria-label={titlebar.language.t("common.goForward")}
                      />
                    </Tooltip>
                  </div>
                </Show>
                <div id="opencode-titlebar-left" class="flex items-center gap-3 min-w-0 px-2" />
                <ChannelIndicator />
              </div>
            </div>
          </div>
        </div>

        <div class="min-w-0 flex items-center justify-center pointer-events-none">
          <div
            id={TITLEBAR_PORTAL_ID.center}
            class="pointer-events-auto min-w-0 flex justify-center w-fit max-w-full"
          />
        </div>

        <div
          classList={{
            "flex items-center min-w-0 justify-end": true,
            "pr-2": !titlebar.windows(),
          }}
        >
          <div id={TITLEBAR_PORTAL_ID.right} class="flex items-center gap-1 shrink-0 justify-end" />
          <Show when={titlebar.windows()}>
            <div class="shrink-0" style={{ width: titlebar.windowsControlsWidth() }} />
          </Show>
        </div>
      </div>
    </header>
  )
}
