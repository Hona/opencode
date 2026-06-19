import { base64Encode } from "@opencode-ai/core/util/encode"
import type { Page } from "@playwright/test"

export function sessionHref(directory: string, sessionID: string) {
  return `/${base64Encode(directory)}/session/${sessionID}`
}

export async function installProjectStorage(page: Page, directory: string) {
  await page.addInitScript((directory) => {
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: { local: directory },
      }),
    )
  }, directory)
}
