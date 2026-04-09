import type { Locator, Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { openSettings, closeDialog, waitTerminalFocusIdle, withSession } from "../actions"
import { keybindButtonSelector, terminalSelector } from "../selectors"
import { modKey } from "../utils"

const saved = (page: Page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })

async function bind(page: Page, button: Locator, combo: string) {
  await button.click()
  await expect(button).toHaveText(/press/i)
  await page.keyboard.press(combo)
}

test("changing sidebar toggle keybind works", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("sidebar.toggle")).first()
  await expect(keybindButton).toBeVisible()

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain("B")

  await bind(page, keybindButton, `${modKey}+Shift+KeyH`)
  await expect(keybindButton).toContainText("H")
  await expect.poll(() => saved(page).then((x) => x?.keybinds?.["sidebar.toggle"])).toBe("mod+shift+h")

  await closeDialog(page, dialog)

  const button = page.getByRole("button", { name: /toggle sidebar/i }).first()
  const initiallyClosed = (await button.getAttribute("aria-expanded")) !== "true"

  await page.keyboard.press(`${modKey}+Shift+H`)
  await expect(button).toHaveAttribute("aria-expanded", initiallyClosed ? "true" : "false")

  const afterToggleClosed = (await button.getAttribute("aria-expanded")) !== "true"
  expect(afterToggleClosed).toBe(!initiallyClosed)

  await page.keyboard.press(`${modKey}+Shift+H`)
  await expect(button).toHaveAttribute("aria-expanded", initiallyClosed ? "false" : "true")

  const finalClosed = (await button.getAttribute("aria-expanded")) !== "true"
  expect(finalClosed).toBe(initiallyClosed)
})

test("sidebar toggle keybind guards against shortcut conflicts", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("sidebar.toggle"))
  await expect(keybindButton).toBeVisible()

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain("B")

  await bind(page, keybindButton, `${modKey}+Shift+KeyP`)

  const toast = page.locator('[data-component="toast"]').last()
  await expect(toast).toBeVisible()
  await expect(toast).toContainText(/already/i)

  await keybindButton.click()
  await expect(keybindButton).toContainText("B")

  await expect.poll(() => saved(page).then((x) => x?.keybinds?.["sidebar.toggle"])).toBeUndefined()

  await closeDialog(page, dialog)
})

test("resetting all keybinds to defaults works", async ({ page, gotoSession }) => {
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ keybinds: { "sidebar.toggle": "mod+shift+x" } }))
  })

  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("sidebar.toggle"))
  await expect(keybindButton).toBeVisible()

  const customKeybind = await keybindButton.textContent()
  expect(customKeybind).toContain("X")

  const resetButton = dialog.getByRole("button", { name: "Reset to defaults" })
  await expect(resetButton).toBeVisible()
  await expect(resetButton).toBeEnabled()
  await resetButton.click()
  await expect(keybindButton).toContainText("B")
  await expect.poll(() => saved(page).then((x) => x?.keybinds?.["sidebar.toggle"])).toBeUndefined()

  await closeDialog(page, dialog)
})

test("clearing a keybind works", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("sidebar.toggle"))
  await expect(keybindButton).toBeVisible()

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain("B")

  await keybindButton.click()
  await expect(keybindButton).toHaveText(/press/i)
  await page.keyboard.press("Delete")
  await expect(keybindButton).toHaveText(/unassigned|press/i)
  await expect.poll(() => saved(page).then((x) => x?.keybinds?.["sidebar.toggle"])).toBe("none")

  await closeDialog(page, dialog)

  const button = page.getByRole("button", { name: /toggle sidebar/i }).first()
  const before = await button.getAttribute("aria-expanded")
  await page.keyboard.press(`${modKey}+B`)
  await expect(button).toHaveAttribute("aria-expanded", before ?? "false")
})

test("changing settings open keybind works", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("settings.open"))
  await expect(keybindButton).toBeVisible()

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain(",")

  await bind(page, keybindButton, `${modKey}+Slash`)
  await expect(keybindButton).toContainText("/")
  await expect.poll(() => saved(page).then((x) => x?.keybinds?.["settings.open"])).toBe("mod+/")

  await closeDialog(page, dialog)

  const settingsDialog = page.getByRole("dialog")
  await expect(settingsDialog).toHaveCount(0)

  await page.keyboard.press(`${modKey}+Slash`)

  await expect(settingsDialog).toBeVisible()

  await closeDialog(page, settingsDialog)
})

test("changing new session keybind works", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, "test session for keybind", async (session) => {
    await gotoSession(session.id)

    const initialUrl = page.url()
    expect(initialUrl).toContain(`/session/${session.id}`)

    const dialog = await openSettings(page)
    await dialog.getByRole("tab", { name: "Shortcuts" }).click()

    const keybindButton = dialog.locator(keybindButtonSelector("session.new"))
    await expect(keybindButton).toBeVisible()

    await bind(page, keybindButton, `${modKey}+Shift+KeyN`)
    await expect(keybindButton).toContainText("N")
    await expect.poll(() => saved(page).then((x) => x?.keybinds?.["session.new"])).toBe("mod+shift+n")

    await closeDialog(page, dialog)

    await page.keyboard.press(`${modKey}+Shift+N`)
    await expect.poll(() => page.url().includes(session.id)).toBe(false)
    await expect(page).toHaveURL(/\/session\/?$/)
  })
})

test("changing file open keybind works", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("file.open"))
  await expect(keybindButton).toBeVisible()

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain("K")

  await bind(page, keybindButton, `${modKey}+Shift+KeyF`)
  await expect(keybindButton).toContainText("F")
  await expect.poll(() => saved(page).then((x) => x?.keybinds?.["file.open"])).toBe("mod+shift+f")

  await closeDialog(page, dialog)

  const filePickerDialog = page.getByRole("dialog").filter({ has: page.getByPlaceholder(/search files/i) })
  await expect(filePickerDialog).toHaveCount(0)

  await page.keyboard.press(`${modKey}+Shift+F`)

  await expect(filePickerDialog).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(filePickerDialog).toHaveCount(0)
})

test("changing terminal toggle keybind works", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("terminal.toggle"))
  await expect(keybindButton).toBeVisible()

  await bind(page, keybindButton, `${modKey}+KeyY`)
  await expect(keybindButton).toContainText("Y")
  await expect.poll(() => saved(page).then((x) => x?.keybinds?.["terminal.toggle"])).toBe("mod+y")

  await closeDialog(page, dialog)

  const terminal = page.locator(terminalSelector)
  await expect(terminal).not.toBeVisible()

  await page.keyboard.press(`${modKey}+Y`)
  await waitTerminalFocusIdle(page, { term: terminal })

  await page.keyboard.press(`${modKey}+Y`)
  await expect(terminal).not.toBeVisible()
})

test("terminal toggle keybind persists after reload", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("terminal.toggle"))
  await expect(keybindButton).toBeVisible()

  await bind(page, keybindButton, `${modKey}+Shift+KeyY`)
  await expect(keybindButton).toContainText("Y")
  await closeDialog(page, dialog)

  await page.reload()

  await expect
    .poll(async () => {
      return await page.evaluate(() => {
        const raw = localStorage.getItem("settings.v3")
        if (!raw) return
        const parsed = JSON.parse(raw)
        return parsed?.keybinds?.["terminal.toggle"]
      })
    })
    .toBe("mod+shift+y")

  const reloaded = await openSettings(page)
  await reloaded.getByRole("tab", { name: "Shortcuts" }).click()
  const reloadedKeybind = reloaded.locator(keybindButtonSelector("terminal.toggle")).first()
  await expect(reloadedKeybind).toContainText("Y")
  await closeDialog(page, reloaded)
})

test("changing command palette keybind works", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("command.palette"))
  await expect(keybindButton).toBeVisible()

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain("P")

  await bind(page, keybindButton, `${modKey}+Shift+KeyK`)
  await expect(keybindButton).toContainText("K")
  await expect.poll(() => saved(page).then((x) => x?.keybinds?.["command.palette"])).toBe("mod+shift+k")

  await closeDialog(page, dialog)

  const palette = page.getByRole("dialog").filter({ has: page.getByRole("textbox").first() })
  await expect(palette).toHaveCount(0)

  await page.keyboard.press(`${modKey}+Shift+K`)

  await expect(palette).toBeVisible()
  await expect(palette.getByRole("textbox").first()).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(palette).toHaveCount(0)
})
