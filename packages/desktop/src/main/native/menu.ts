import { BrowserWindow, Menu } from "electron"
import type { MenuItemConstructorOptions } from "electron"
import {
  DESKTOP_MENU,
  desktopMenuVisible,
  type DesktopMenu,
  type DesktopMenuEntry,
  type DesktopMenuRole,
} from "@opencode/app/desktop-menu"
import { MenuCommandTriggered } from "../../shared/ipc-rpc/events"
import { emitIpcEvent } from "../ipc-events"

import { CHANNEL, UPDATER_ENABLED } from "../constants"
import { runDesktopMenuAction } from "./menu-actions"
import { nativeT } from "./translations"

type Deps = {
  trigger: (id: string) => void
  checkForUpdates: () => void
  installCli: () => void
  createWindow: () => void
  openExternal: (url: string) => void
  relaunch: () => void
}

/** A GUI extension's contribution to the native menu, already translated by the extension. */
export type MenubarEntry = {
  readonly menu: string
  readonly id: string
  readonly label: string
  /** A built-in item's command or action, or another contribution's id. */
  readonly after?: string
  enabled(): boolean
  run(): void
}

let menubar: () => readonly MenubarEntry[] = () => []
let installed: Deps | undefined

/** Contributions are read on every build; setting a provider rebuilds an installed menu. */
export function setMenubarProvider(provider: () => readonly MenubarEntry[]) {
  menubar = provider
  refreshMenu()
}

/** Rebuilds an installed menu after its contributions changed. */
export function refreshMenu() {
  if (installed) createMenu(installed)
}

export function createMenu(deps: Deps) {
  installed = deps
  if (process.platform !== "darwin") return

  const extra = menubar()
  const template = DESKTOP_MENU.filter((menu) => desktopMenuVisible(menu, "macos")).map((menu) =>
    nativeMenu(
      menu,
      extra.filter((item) => item.menu === menu.id),
      deps,
    ),
  )

  const built = Menu.buildFromTemplate(template)
  // Electron freezes a built item's state; contributions re-read theirs whenever a menu opens.
  const refresh = () =>
    extra.forEach((item) => {
      const target = built.getMenuItemById(item.id)
      if (target) target.enabled = item.enabled()
    })
  if (extra.length) built.items.forEach((item) => item.submenu?.on("menu-will-show", refresh))
  Menu.setApplicationMenu(built)
}

export function sendMenuCommand(win: BrowserWindow, id: string) {
  emitIpcEvent(win.webContents, new MenuCommandTriggered({ id }))
}

function nativeMenu(menu: DesktopMenu, extra: readonly MenubarEntry[], deps: Deps): MenuItemConstructorOptions {
  if (menu.role && !extra.length) return { role: nativeRole(menu.role), label: nativeT(menu.labelKey) }
  const base = (menu.items ?? [])
    .filter((entry) => desktopMenuVisible(entry, "macos"))
    .map((entry) => ({
      key: entry.type === "item" ? (entry.command ?? entry.action) : undefined,
      item: nativeItem(entry, deps),
    }))
  const items = extra.reduce((list, entry) => {
    const next = {
      key: entry.id,
      item: { id: entry.id, label: entry.label, enabled: entry.enabled(), click: () => entry.run() },
    }
    const index = entry.after ? list.findIndex((item) => item.key === entry.after) : -1
    if (index < 0) return [...list, next]
    return [...list.slice(0, index + 1), next, ...list.slice(index + 1)]
  }, base)
  return {
    ...(menu.role ? { role: nativeRole(menu.role) } : {}),
    label: nativeT(menu.labelKey),
    submenu: items.map((entry) => entry.item),
  }
}

function nativeItem(entry: DesktopMenuEntry, deps: Deps): MenuItemConstructorOptions {
  if (entry.type === "separator") return { type: "separator" }
  if (entry.role) return { role: nativeRole(entry.role), label: entry.labelKey ? nativeT(entry.labelKey) : undefined }

  const item: MenuItemConstructorOptions = {
    label: entry.labelKey ? nativeT(entry.labelKey) : undefined,
    accelerator: entry.accelerator?.macos,
    enabled: entry.enabled === "updater" ? UPDATER_ENABLED : undefined,
  }

  if (entry.command) {
    const command = entry.command
    item.click = () => deps.trigger(command)
  }
  if (entry.action) {
    const action = entry.action
    if (action === "app.checkForUpdates" && CHANNEL === "beta") {
      item.click = () => deps.trigger(action)
      return item
    }
    item.click = () =>
      runDesktopMenuAction(BrowserWindow.getFocusedWindow(), action, {
        checkForUpdates: deps.checkForUpdates,
        installCli: deps.installCli,
        createWindow: deps.createWindow,
        relaunch: deps.relaunch,
      })
  }
  if (entry.href) {
    const href = entry.href
    item.click = () => deps.openExternal(href)
  }

  return item
}

function nativeRole(role: DesktopMenuRole) {
  return role as NonNullable<MenuItemConstructorOptions["role"]>
}
