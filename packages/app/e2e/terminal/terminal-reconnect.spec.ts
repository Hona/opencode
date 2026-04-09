import type { Page } from "@playwright/test"
import { disconnectTerminal, runTerminal, terminalConnects, waitTerminalReady } from "../actions"
import { test, expect } from "../fixtures"
import { terminalSelector } from "../selectors"
import { terminalToggleKey } from "../utils"

async function open(page: Page) {
  const term = page.locator(terminalSelector).first()
  const visible = await term.isVisible().catch(() => false)
  if (!visible) await page.keyboard.press(terminalToggleKey)
  await waitTerminalReady(page, { term })
  return term
}

test("terminal reconnects without replacing the pty", async ({ page, project }) => {
  await project.open()
  const one = `E2E_RECONNECT_${Date.now()}_ONE`
  const two = `E2E_RECONNECT_${Date.now()}_TWO`
  const set =
    process.platform === "win32"
      ? `$Env:OPENCODE_E2E_RECONNECT='${one}'; Write-Output $Env:OPENCODE_E2E_RECONNECT`
      : `export OPENCODE_E2E_RECONNECT='${one}'; echo $OPENCODE_E2E_RECONNECT`
  const check =
    process.platform === "win32"
      ? `Write-Output "$Env:OPENCODE_E2E_RECONNECT ${two}"`
      : `echo "$OPENCODE_E2E_RECONNECT ${two}"`

  await project.gotoSession()

  const term = await open(page)
  const id = await term.getAttribute("data-pty-id")
  if (!id) throw new Error("Active terminal missing data-pty-id")

  const prev = await terminalConnects(page, { term })

  await runTerminal(page, {
    term,
    cmd: set,
    token: one,
  })

  await disconnectTerminal(page, { term })

  await expect.poll(() => terminalConnects(page, { term }), { timeout: 15_000 }).toBeGreaterThan(prev)
  await expect.poll(() => term.getAttribute("data-pty-id"), { timeout: 5_000 }).toBe(id)

  await runTerminal(page, {
    term,
    cmd: check,
    token: `${one} ${two}`,
    timeout: 15_000,
  })
})
