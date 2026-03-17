import type { Page, Route } from "@playwright/test"
import type { Event as AppEvent, Session as SessionInfo } from "@opencode-ai/sdk/v2/client"
import { test, expect } from "../fixtures"
import {
  composerEvent,
  type ComposerDriverState,
  type ComposerProbeState,
  type ComposerWindow,
} from "../../src/testing/session-composer"
import { cleanupSession } from "../actions"
import {
  permissionDockSelector,
  promptSelector,
  questionDockSelector,
  sessionComposerDockSelector,
  sessionTodoToggleButtonSelector,
} from "../selectors"

const e2eEvent = "opencode:e2e:global-event"

type Sdk = NonNullable<Parameters<typeof cleanupSession>[0]["sdk"]>
type Child = SessionInfo
type PermissionRule = { permission: string; pattern: string; action: "allow" | "deny" | "ask" }

async function enableEvents(page: Page) {
  await page.addInitScript(() => {
    const win = window as ComposerWindow & {
      __opencode_e2e?: {
        event?: {
          enabled?: boolean
        }
      }
    }
    win.__opencode_e2e = {
      ...win.__opencode_e2e,
      event: {
        ...win.__opencode_e2e?.event,
        enabled: true,
      },
    }
  })
}

async function emitEvent(page: Page, directory: string, payload: AppEvent) {
  await page.evaluate(
    (input) => {
      window.dispatchEvent(new CustomEvent(input.name, { detail: input.detail }))
    },
    { name: e2eEvent, detail: { directory, payload } },
  )
}

async function withDockSession<T>(
  sdk: Sdk,
  title: string,
  fn: (session: { id: string; title: string }) => Promise<T>,
  opts?: { permission?: PermissionRule[] },
) {
  const session = await sdk.session
    .create(opts?.permission ? { title, permission: opts.permission } : { title })
    .then((r) => r.data)
  if (!session?.id) throw new Error("Session create did not return an id")
  try {
    return await fn(session)
  } finally {
    await cleanupSession({ sdk, sessionID: session.id })
  }
}

test.setTimeout(120_000)

async function clearPermissionDock(page: Page, label: RegExp) {
  const dock = page.locator(permissionDockSelector)
  await expect(dock).toBeVisible()
  await dock.getByRole("button", { name: label }).click()
}

async function setAutoAccept(page: Page, enabled: boolean) {
  const button = page.locator('[data-action="prompt-permissions"]').first()
  await expect(button).toBeVisible()
  const pressed = (await button.getAttribute("aria-pressed")) === "true"
  if (pressed === enabled) return
  await button.click()
  await expect(button).toHaveAttribute("aria-pressed", enabled ? "true" : "false")
}

async function expectQuestionBlocked(page: Page) {
  await expect(page.locator(questionDockSelector)).toBeVisible()
  await expect(page.locator(promptSelector)).toHaveCount(0)
}

async function expectQuestionOpen(page: Page) {
  await expect(page.locator(questionDockSelector)).toHaveCount(0)
  await expect(page.locator(promptSelector)).toBeVisible()
}

async function expectPermissionBlocked(page: Page) {
  await expect(page.locator(permissionDockSelector)).toBeVisible()
  await expect(page.locator(promptSelector)).toHaveCount(0)
}

async function expectPermissionOpen(page: Page) {
  await expect(page.locator(permissionDockSelector)).toHaveCount(0)
  await expect(page.locator(promptSelector)).toBeVisible()
}

async function todoDock(page: Page, sessionID: string) {
  await page.addInitScript(() => {
    const win = window as ComposerWindow
    win.__opencode_e2e = {
      ...win.__opencode_e2e,
      composer: {
        enabled: true,
        sessions: {},
      },
    }
  })

  const write = async (driver: ComposerDriverState | undefined) => {
    await page.evaluate(
      (input) => {
        const win = window as ComposerWindow
        const composer = win.__opencode_e2e?.composer
        if (!composer?.enabled) throw new Error("Composer e2e driver is not enabled")
        composer.sessions ??= {}
        const prev = composer.sessions[input.sessionID] ?? {}
        if (!input.driver) {
          if (!prev.probe) {
            delete composer.sessions[input.sessionID]
          } else {
            composer.sessions[input.sessionID] = { probe: prev.probe }
          }
        } else {
          composer.sessions[input.sessionID] = {
            ...prev,
            driver: input.driver,
          }
        }
        window.dispatchEvent(new CustomEvent(input.event, { detail: { sessionID: input.sessionID } }))
      },
      { event: composerEvent, sessionID, driver },
    )
  }

  const read = () =>
    page.evaluate((sessionID) => {
      const win = window as ComposerWindow
      return win.__opencode_e2e?.composer?.sessions?.[sessionID]?.probe ?? null
    }, sessionID) as Promise<ComposerProbeState | null>

  const api = {
    async clear() {
      await write(undefined)
      return api
    },
    async open(todos: NonNullable<ComposerDriverState["todos"]>) {
      await write({ live: true, todos })
      return api
    },
    async finish(todos: NonNullable<ComposerDriverState["todos"]>) {
      await write({ live: false, todos })
      return api
    },
    async expectOpen(states: ComposerProbeState["states"]) {
      await expect.poll(read, { timeout: 10_000 }).toMatchObject({
        mounted: true,
        collapsed: false,
        hidden: false,
        count: states.length,
        states,
      })
      return api
    },
    async expectCollapsed(states: ComposerProbeState["states"]) {
      await expect.poll(read, { timeout: 10_000 }).toMatchObject({
        mounted: true,
        collapsed: true,
        hidden: true,
        count: states.length,
        states,
      })
      return api
    },
    async expectClosed() {
      await expect.poll(read, { timeout: 10_000 }).toMatchObject({ mounted: false })
      return api
    },
    async collapse() {
      await page.locator(sessionTodoToggleButtonSelector).click()
      return api
    },
    async expand() {
      await page.locator(sessionTodoToggleButtonSelector).click()
      return api
    },
  }

  return api
}

async function withMockPermission<T>(
  page: Page,
  directory: string,
  request: {
    id: string
    sessionID: string
    permission: string
    patterns: string[]
    metadata?: Record<string, unknown>
    always?: string[]
  },
  opts: { child?: Child } | undefined,
  fn: (state: { ask: () => Promise<void>; resolved: () => Promise<void> }) => Promise<T>,
) {
  let pending = [
    {
      ...request,
      always: request.always ?? ["*"],
      metadata: request.metadata ?? {},
    },
  ]

  const list = async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pending),
    })
  }

  const reply = async (route: Route) => {
    const url = new URL(route.request().url())
    const id = url.pathname.split("/").pop()
    const item = pending.find((entry) => entry.id === id)
    pending = pending.filter((item) => item.id !== id)
    if (item) {
      await emitEvent(page, directory, {
        type: "permission.replied",
        properties: { sessionID: item.sessionID, requestID: item.id },
      })
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(true),
    })
  }

  await page.route("**/permission", list)
  await page.route("**/session/*/permissions/*", reply)

  const state = {
    async ask() {
      if (opts?.child) {
        await emitEvent(page, directory, {
          type: "session.created",
          properties: { info: opts.child },
        })
      }
      await emitEvent(page, directory, {
        type: "permission.asked",
        properties: pending[0],
      })
    },
    async resolved() {
      await expect.poll(() => pending.length, { timeout: 10_000 }).toBe(0)
    },
  }

  try {
    return await fn(state)
  } finally {
    await page.unroute("**/permission", list)
    await page.unroute("**/session/*/permissions/*", reply)
  }
}

async function withMockQuestion<T>(
  page: Page,
  directory: string,
  request: {
    id: string
    sessionID: string
    questions: Array<{
      header: string
      question: string
      options: Array<{ label: string; description: string }>
      multiple?: boolean
    }>
  },
  opts: { child?: Child } | undefined,
  fn: (state: { ask: () => Promise<void>; resolved: () => Promise<void> }) => Promise<T>,
) {
  let pending = [request]

  const list = async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pending),
    })
  }

  const reply = async (route: Route) => {
    const url = new URL(route.request().url())
    const id = url.pathname.split("/").at(-2)
    const item = pending.find((entry) => entry.id === id)
    pending = pending.filter((entry) => entry.id !== id)
    if (item) {
      await emitEvent(page, directory, {
        type: url.pathname.endsWith("/reject") ? "question.rejected" : "question.replied",
        properties: { sessionID: item.sessionID, requestID: item.id },
      })
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(true),
    })
  }

  await page.route("**/question", list)
  await page.route("**/question/*/reply", reply)
  await page.route("**/question/*/reject", reply)

  const state = {
    async ask() {
      if (opts?.child) {
        await emitEvent(page, directory, {
          type: "session.created",
          properties: { info: opts.child },
        })
      }
      await emitEvent(page, directory, {
        type: "question.asked",
        properties: pending[0],
      })
    },
    async resolved() {
      await expect.poll(() => pending.length, { timeout: 10_000 }).toBe(0)
    },
  }

  try {
    return await fn(state)
  } finally {
    await page.unroute("**/question", list)
    await page.unroute("**/question/*/reply", reply)
    await page.unroute("**/question/*/reject", reply)
  }
}

test("default dock shows prompt input", async ({ page, sdk, gotoSession }) => {
  await withDockSession(sdk, "e2e composer dock default", async (session) => {
    await gotoSession(session.id)

    await expect(page.locator(sessionComposerDockSelector)).toBeVisible()
    await expect(page.locator(promptSelector)).toBeVisible()
    await expect(page.locator(questionDockSelector)).toHaveCount(0)
    await expect(page.locator(permissionDockSelector)).toHaveCount(0)

    await page.locator(promptSelector).click()
    await expect(page.locator(promptSelector)).toBeFocused()
  })
})

test("auto-accept toggle works before first submit", async ({ page, gotoSession }) => {
  await gotoSession()

  const button = page.locator('[data-action="prompt-permissions"]').first()
  await expect(button).toBeVisible()
  await expect(button).toHaveAttribute("aria-pressed", "false")

  await setAutoAccept(page, true)
  await setAutoAccept(page, false)
})

test("blocked question flow unblocks after submit", async ({ page, sdk, gotoSession }) => {
  await withDockSession(sdk, "e2e composer dock question", async (session) => {
    const directory = await sdk.path.get().then((x) => x.data?.directory ?? "")
    await enableEvents(page)
    await gotoSession(session.id)
    await withMockQuestion(
      page,
      directory,
      {
        id: "q_e2e_blocked",
        sessionID: session.id,
        questions: [
          {
            header: "Need input",
            question: "Pick one option",
            options: [
              { label: "Continue", description: "Continue now" },
              { label: "Stop", description: "Stop here" },
            ],
          },
        ],
      },
      undefined,
      async (state) => {
        await state.ask()

        const dock = page.locator(questionDockSelector)
        await expectQuestionBlocked(page)

        await dock.locator('[data-slot="question-option"]').first().click()
        await dock.getByRole("button", { name: /submit/i }).click()
        await state.resolved()

        await expectQuestionOpen(page)
      },
    )
  })
})

test("blocked permission flow supports allow once", async ({ page, sdk, gotoSession }) => {
  await withDockSession(sdk, "e2e composer dock permission once", async (session) => {
    const directory = await sdk.path.get().then((x) => x.data?.directory ?? "")
    await enableEvents(page)
    await gotoSession(session.id)
    await setAutoAccept(page, false)
    await withMockPermission(
      page,
      directory,
      {
        id: "per_e2e_once",
        sessionID: session.id,
        permission: "bash",
        patterns: ["/tmp/opencode-e2e-perm-once"],
        metadata: { description: "Need permission for command" },
      },
      undefined,
      async (state) => {
        await state.ask()
        await expectPermissionBlocked(page)

        await clearPermissionDock(page, /allow once/i)
        await state.resolved()
        await expectPermissionOpen(page)
      },
    )
  })
})

test("blocked permission flow supports reject", async ({ page, sdk, gotoSession }) => {
  await withDockSession(sdk, "e2e composer dock permission reject", async (session) => {
    const directory = await sdk.path.get().then((x) => x.data?.directory ?? "")
    await enableEvents(page)
    await gotoSession(session.id)
    await setAutoAccept(page, false)
    await withMockPermission(
      page,
      directory,
      {
        id: "per_e2e_reject",
        sessionID: session.id,
        permission: "bash",
        patterns: ["/tmp/opencode-e2e-perm-reject"],
      },
      undefined,
      async (state) => {
        await state.ask()
        await expectPermissionBlocked(page)

        await clearPermissionDock(page, /deny/i)
        await state.resolved()
        await expectPermissionOpen(page)
      },
    )
  })
})

test("blocked permission flow supports allow always", async ({ page, sdk, gotoSession }) => {
  await withDockSession(sdk, "e2e composer dock permission always", async (session) => {
    const directory = await sdk.path.get().then((x) => x.data?.directory ?? "")
    await enableEvents(page)
    await gotoSession(session.id)
    await setAutoAccept(page, false)
    await withMockPermission(
      page,
      directory,
      {
        id: "per_e2e_always",
        sessionID: session.id,
        permission: "bash",
        patterns: ["/tmp/opencode-e2e-perm-always"],
        metadata: { description: "Need permission for command" },
      },
      undefined,
      async (state) => {
        await state.ask()
        await expectPermissionBlocked(page)

        await clearPermissionDock(page, /allow always/i)
        await state.resolved()
        await expectPermissionOpen(page)
      },
    )
  })
})

test("child session question request blocks parent dock and unblocks after submit", async ({
  page,
  sdk,
  gotoSession,
}) => {
  await withDockSession(sdk, "e2e composer dock child question parent", async (session) => {
    const directory = await sdk.path.get().then((x) => x.data?.directory ?? "")
    await enableEvents(page)
    await gotoSession(session.id)

    const child = await sdk.session
      .create({
        title: "e2e composer dock child question",
        parentID: session.id,
      })
      .then((r) => r.data)
    if (!child?.id) throw new Error("Child session create did not return an id")

    try {
      await withMockQuestion(
        page,
        directory,
        {
          id: "q_e2e_child",
          sessionID: child.id,
          questions: [
            {
              header: "Child input",
              question: "Pick one child option",
              options: [
                { label: "Continue", description: "Continue child" },
                { label: "Stop", description: "Stop child" },
              ],
            },
          ],
        },
        { child },
        async (state) => {
          await state.ask()

          const dock = page.locator(questionDockSelector)
          await expectQuestionBlocked(page)

          await dock.locator('[data-slot="question-option"]').first().click()
          await dock.getByRole("button", { name: /submit/i }).click()
          await state.resolved()

          await expectQuestionOpen(page)
        },
      )
    } finally {
      await cleanupSession({ sdk, sessionID: child.id })
    }
  })
})

test("child session permission request blocks parent dock and supports allow once", async ({
  page,
  sdk,
  gotoSession,
}) => {
  await withDockSession(sdk, "e2e composer dock child permission parent", async (session) => {
    const directory = await sdk.path.get().then((x) => x.data?.directory ?? "")
    await enableEvents(page)
    await gotoSession(session.id)
    await setAutoAccept(page, false)

    const child = await sdk.session
      .create({
        title: "e2e composer dock child permission",
        parentID: session.id,
      })
      .then((r) => r.data)
    if (!child?.id) throw new Error("Child session create did not return an id")

    try {
      await withMockPermission(
        page,
        directory,
        {
          id: "per_e2e_child",
          sessionID: child.id,
          permission: "bash",
          patterns: ["/tmp/opencode-e2e-perm-child"],
          metadata: { description: "Need child permission" },
        },
        { child },
        async (state) => {
          await state.ask()
          await expectPermissionBlocked(page)

          await clearPermissionDock(page, /allow once/i)
          await state.resolved()

          await expectPermissionOpen(page)
        },
      )
    } finally {
      await cleanupSession({ sdk, sessionID: child.id })
    }
  })
})

test("todo dock transitions and collapse behavior", async ({ page, sdk, gotoSession }) => {
  await withDockSession(sdk, "e2e composer dock todo", async (session) => {
    const dock = await todoDock(page, session.id)
    await gotoSession(session.id)
    await expect(page.locator(sessionComposerDockSelector)).toBeVisible()

    try {
      await dock.open([
        { content: "first task", status: "pending", priority: "high" },
        { content: "second task", status: "in_progress", priority: "medium" },
      ])
      await dock.expectOpen(["pending", "in_progress"])

      await dock.collapse()
      await dock.expectCollapsed(["pending", "in_progress"])

      await dock.expand()
      await dock.expectOpen(["pending", "in_progress"])

      await dock.finish([
        { content: "first task", status: "completed", priority: "high" },
        { content: "second task", status: "cancelled", priority: "medium" },
      ])
      await dock.expectClosed()
    } finally {
      await dock.clear()
    }
  })
})

test("keyboard focus stays off prompt while blocked", async ({ page, sdk, gotoSession }) => {
  await withDockSession(sdk, "e2e composer dock keyboard", async (session) => {
    const directory = await sdk.path.get().then((x) => x.data?.directory ?? "")
    await enableEvents(page)
    await gotoSession(session.id)
    await withMockQuestion(
      page,
      directory,
      {
        id: "q_e2e_keyboard",
        sessionID: session.id,
        questions: [
          {
            header: "Need input",
            question: "Pick one option",
            options: [{ label: "Continue", description: "Continue now" }],
          },
        ],
      },
      undefined,
      async (state) => {
        await state.ask()
        await expectQuestionBlocked(page)

        await page.locator("main").click({ position: { x: 5, y: 5 } })
        await page.keyboard.type("abc")
        await expect(page.locator(promptSelector)).toHaveCount(0)
      },
    )
  })
})
