import { beforeAll, expect, mock, test } from "bun:test"
import type { Repository } from "@/persistence"
import { createEffect, createRoot } from "solid-js"

let createReviewPanelV2State: typeof import("@/pages/session/v2/review-panel-v2-state").createReviewPanelV2State
let read: ((value: string | null) => void) | undefined

const persistence: Repository = {
  read: () => new Promise((resolve) => (read = resolve)),
  commit: () => undefined,
  remove: async () => undefined,
  putBlob: async (bytes) => ({ digest: "digest", byteLength: bytes.byteLength }),
  readBlob: async () => null,
  drain: async () => undefined,
}

beforeAll(async () => {
  mock.module("@opencode-ai/session-ui/v2/session-review-v2", () => ({
    SESSION_REVIEW_V2_SIDEBAR_WIDTH_DEFAULT: 240,
    SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN: 200,
    SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX: 480,
  }))
  mock.module("@/context/platform", () => ({
    usePlatform: () => ({ platform: "desktop", persistence }),
  }))

  createReviewPanelV2State = (await import("@/pages/session/v2/review-panel-v2-state")).createReviewPanelV2State
})

test("enables sidebar motion only after custom width hydration", async () => {
  await new Promise<void>((resolve, reject) => {
    createRoot((dispose) => {
      const state = createReviewPanelV2State()
      const transition =
        "sidebarTransition" in state && typeof state.sidebarTransition === "function"
          ? (state.sidebarTransition as () => boolean)
          : undefined

      try {
        expect(transition).toBeFunction()
        expect(transition?.()).toBeFalse()
        expect(state.sidebarWidth()).toBe(240)
      } catch (error) {
        dispose()
        reject(error)
        return
      }

      createEffect(() => {
        if (!transition?.()) return
        try {
          expect(state.sidebarWidth()).toBe(360)
          dispose()
          resolve()
        } catch (error) {
          dispose()
          reject(error)
        }
      })

      read?.(JSON.stringify({ sidebarOpened: true, sidebarWidth: 360, expandMode: "collapse" }))
    })
  })
})
