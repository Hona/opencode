import type { Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../../utils/mock-server"
import { fixture } from "./session-timeline-stress.fixture"

export async function installTimelineSettings(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({
        general: {
          editToolPartsExpanded: true,
          shellToolPartsExpanded: true,
          showReasoningSummaries: true,
          showSessionProgressBar: true,
        },
      }),
    )
  })
}

export function mockStressTimeline(page: Page) {
  return mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages: (sessionID) => ({ items: fixture.messages[sessionID as keyof typeof fixture.messages] ?? [] }),
  })
}

export async function installStressSessionTabs(page: Page) {
  await page.addInitScript(
    ({ directory, sourceID, targetID, dirBase64 }) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.global.dat:tabs",
        JSON.stringify(
          [sourceID, targetID].map((sessionId) => ({
            type: "session",
            server: "http://127.0.0.1:4096",
            dirBase64,
            sessionId,
          })),
        ),
      )
    },
    {
      directory: fixture.directory,
      sourceID: fixture.sourceID,
      targetID: fixture.targetID,
      dirBase64: base64Encode(fixture.directory),
    },
  )
}

export function stressSessionHref(sessionID: string) {
  return `/${base64Encode(fixture.directory)}/session/${sessionID}`
}
