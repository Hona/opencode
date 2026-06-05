import { createEffect, createMemo, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { usePlatform } from "@/context/platform"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { applyPath, backPath, forwardPath } from "./titlebar-history"

const minTitlebarZoom = 0.25
const windowsControlsBaseWidth = 138 // 3 native Windows caption buttons at 46px each.

export const TITLEBAR_PORTAL_ID = {
  center: "opencode-titlebar-center",
  right: "opencode-titlebar-right",
} as const

export const TITLEBAR_DRAG_CLASS = "[app-region:drag] [&_button]:[app-region:no-drag] [&_a]:[app-region:no-drag] [&_input]:[app-region:no-drag] [&_[role=button]]:[app-region:no-drag] [&_[role=menuitem]]:[app-region:no-drag]"

export function useTitlebarRuntime(height: number) {
  const platform = usePlatform()
  const command = useCommand()
  const language = useLanguage()
  const navigate = useNavigate()
  const location = useLocation()
  const mac = createMemo(() => platform.platform === "desktop" && platform.os === "macos")
  const windows = createMemo(() => platform.platform === "desktop" && platform.os === "windows")
  const linux = createMemo(() => platform.platform === "desktop" && platform.os === "linux")
  const web = createMemo(() => platform.platform === "web")
  const zoom = () => platform.webviewZoom?.() ?? 1
  const titlebarZoom = () => (windows() ? Math.max(zoom(), minTitlebarZoom) : zoom())
  const counterZoom = () => (windows() && titlebarZoom() < 1 ? 1 / titlebarZoom() : 1)
  const minHeight = () => {
    if (mac()) return `${height / zoom()}px`
    if (windows()) return `${height / Math.min(titlebarZoom(), 1)}px`
    return undefined
  }
  const windowsControlsWidth = () => `${windowsControlsBaseWidth / Math.max(titlebarZoom(), 1)}px`

  const [history, setHistory] = createStore({
    stack: [] as string[],
    index: 0,
    action: undefined as "back" | "forward" | undefined,
  })

  createEffect(() => {
    const current = `${location.pathname}${location.search}${location.hash}`

    untrack(() => {
      const next = applyPath(history, current)
      if (next === history) return
      setHistory(next)
    })
  })

  const canBack = createMemo(() => history.index > 0)
  const canForward = createMemo(() => history.index < history.stack.length - 1)
  const back = () => {
    const next = backPath(history)
    if (!next) return
    setHistory(next.state)
    navigate(next.to)
  }
  const forward = () => {
    const next = forwardPath(history)
    if (!next) return
    setHistory(next.state)
    navigate(next.to)
  }

  command.register(() => [
    {
      id: "common.goBack",
      title: language.t("common.goBack"),
      category: language.t("command.category.view"),
      keybind: "mod+[",
      onSelect: back,
    },
    {
      id: "common.goForward",
      title: language.t("common.goForward"),
      category: language.t("command.category.view"),
      keybind: "mod+]",
      onSelect: forward,
    },
  ])

  return {
    platform,
    command,
    language,
    mac,
    windows,
    linux,
    web,
    zoom,
    counterZoom,
    minHeight,
    windowsControlsWidth,
    canBack,
    canForward,
    back,
    forward,
  }
}

export function ChannelIndicator() {
  return (
    <>
      {["beta", "dev"].includes(import.meta.env.VITE_OPENCODE_CHANNEL) && (
        <div class="bg-icon-interactive-base text-[#FFF] font-medium px-2 rounded-sm uppercase font-mono">
          {import.meta.env.VITE_OPENCODE_CHANNEL.toUpperCase()}
        </div>
      )}
    </>
  )
}
