import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import {
  completeSessionFollowup,
  createSessionRequestTracker,
  createSessionOwnership,
  loadOwnedHistory,
  openSessionDialog,
  runSessionCommand,
  runPromptRollbackMutation,
  scheduleSessionRender,
  sessionViewState,
} from "../src/pages/session/session-ownership"

describe("createSessionOwnership", () => {
  test("does not run an A continuation after navigation to B", () => {
    const [session, setSession] = createSignal("A")
    const prompts: Record<string, string> = { A: "draft A", B: "draft B" }
    const owner = createSessionOwnership(session).capture()

    setSession("B")
    owner.run(() => {
      prompts[session()] = "restored A"
    })

    expect(prompts).toEqual({ A: "draft A", B: "draft B" })
  })

  test("does not revive an A continuation after A to B to A navigation", () => {
    const [session, setSession] = createSignal("A")
    const ownership = createSessionOwnership(session)
    const owner = ownership.capture()

    setSession("B")
    setSession("A")

    expect(owner.current()).toBe(false)
  })
})

describe("createSessionRequestTracker", () => {
  test("tracks history requests independently by session", () => {
    const requests = createSessionRequestTracker()

    expect(requests.start("A")).toBe(true)
    expect(requests.start("A")).toBe(false)
    expect(requests.start("B")).toBe(true)
    requests.finish("A")

    expect(requests.pending("A")).toBe(false)
    expect(requests.pending("B")).toBe(true)
  })
})

describe("loadOwnedHistory", () => {
  test("allows B to load while A is pending and drops A's stale continuation", async () => {
    const [session, setSession] = createSignal("A")
    const ownership = createSessionOwnership(session)
    const requests = createSessionRequestTracker()
    const loads = { A: Promise.withResolvers<void>(), B: Promise.withResolvers<void>() }
    const counts = { A: 1, B: 1 }
    const calls: string[] = []
    const load = () =>
      loadOwnedHistory({
        ownership,
        requests,
        loading: () => false,
        count: () => counts[session() as "A" | "B"],
        load: () => {
          const captured = session() as "A" | "B"
          calls.push(captured)
          return loads[captured].promise
        },
      })

    const pendingA = load()
    setSession("B")
    const pendingB = load()
    counts.A++
    loads.A.resolve()
    expect(await pendingA).toBeUndefined()
    counts.B++
    loads.B.resolve()

    expect(await pendingB).toBeDefined()
    expect(calls).toEqual(["A", "B"])
  })

  test("keeps a new A generation independent from a pending old A generation", async () => {
    const [session, setSession] = createSignal("A")
    const ownership = createSessionOwnership(session)
    const requests = createSessionRequestTracker()
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    const counts = [1, 1]
    let generation = 0
    const load = () => {
      const current = generation++
      return loadOwnedHistory({
        ownership,
        requests,
        loading: () => false,
        count: () => counts[current],
        load: () => (current === 0 ? first.promise : second.promise),
      })
    }

    const pendingFirst = load()
    setSession("B")
    setSession("A")
    const pendingSecond = load()
    counts[0]++
    first.resolve()
    expect(await pendingFirst).toBeUndefined()
    counts[1]++
    second.resolve()

    expect(await pendingSecond).toBeDefined()
  })
})

describe("scheduleSessionRender", () => {
  test("ignores a stale frame and timer after an ABA session change", async () => {
    const [session, setSession] = createSignal("A")
    let renders = 0

    scheduleSessionRender({
      ownership: createSessionOwnership(session),
      render: () => renders++,
    })
    setSession("B")
    setSession("A")
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))

    expect(renders).toBe(0)
  })
})

describe("openSessionDialog", () => {
  test("does not open a dialog loaded for an old A generation", async () => {
    const [session, setSession] = createSignal("A")
    const loaded = Promise.withResolvers<string>()
    const shown: string[] = []
    const pending = openSessionDialog({
      ownership: createSessionOwnership(session),
      load: () => loaded.promise,
      show: (value) => shown.push(value),
    })

    setSession("B")
    setSession("A")
    loaded.resolve("dialog for A")
    await pending

    expect(shown).toEqual([])
  })
})

describe("runSessionCommand", () => {
  type Prompt = { set: (value: string) => void; reset: () => void }
  test.each([
    { name: "undo", expected: "sent A", update: (prompt: Prompt) => prompt.set("sent A") },
    { name: "redo", expected: "", update: (prompt: Prompt) => prompt.reset() },
  ])("updates the captured prompt but not the stale viewport after $name", async ({ expected, update }) => {
    const [session, setSession] = createSignal<"A" | "B">("A")
    const ownership = createSessionOwnership(session)
    const prompts = { A: "draft A", B: "draft B" }
    const viewport: string[] = []
    const request = Promise.withResolvers<void>()
    const captured = session()
    const pending = runSessionCommand({
      owner: ownership.capture(),
      prompt: {
        set: (value: string) => {
          prompts[captured] = value
        },
        reset: () => {
          prompts[captured] = ""
        },
      },
      request: () => request.promise,
      updatePrompt: update,
      updateViewport: () => viewport.push(session()),
    })

    setSession("B")
    setSession("A")
    request.resolve()
    await pending

    expect(prompts).toEqual({ A: expected, B: "draft B" })
    expect(viewport).toEqual([])
  })
})

describe("completeSessionFollowup", () => {
  test("removes the captured followup without resuming a stale viewport", () => {
    const [session, setSession] = createSignal("A")
    const ownership = createSessionOwnership(session)
    const items = { A: ["followup"], B: ["other"] }
    const resumed: string[] = []
    const owner = ownership.capture()

    setSession("B")
    setSession("A")
    completeSessionFollowup({
      owner,
      remove: () => items.A.splice(0),
      resume: () => resumed.push(session()),
    })

    expect(items).toEqual({ A: [], B: ["other"] })
    expect(resumed).toEqual([])
  })
})

test("session view state returns to the conversation on navigation", () => {
  expect(sessionViewState()).toEqual({
    messageId: undefined,
    mobileTab: "session",
    changes: "git",
  })
})

describe("runPromptRollbackMutation", () => {
  test.each([
    { name: "revert", optimistic: (prompt: { set: (value: string[]) => void }) => prompt.set(["optimistic A"]) },
    { name: "restore", optimistic: (prompt: { reset: () => void }) => prompt.reset() },
  ])("rolls back a failed $name against its captured prompt", async ({ optimistic }) => {
    let session = "A"
    const prompts: Record<string, string> = { A: "draft A", B: "draft B" }
    const state = { completed: false, rolledBack: false, errors: [] as unknown[] }
    const request = Promise.withResolvers<void>()
    const pending = runPromptRollbackMutation({
      capturePrompt: () => {
        const captured = session
        return {
          current: () => [prompts[captured]],
          set: (value: string[]) => {
            prompts[captured] = value.join("")
          },
          reset: () => {
            prompts[captured] = ""
          },
        }
      },
      optimistic,
      request: () => request.promise,
      complete: () => {
        state.completed = true
      },
      rollback: () => {
        state.rolledBack = true
      },
      fail: (error) => state.errors.push(error),
    })

    session = "B"
    session = "A"
    request.reject(new Error("request failed"))
    await pending

    expect(prompts).toEqual({ A: "draft A", B: "draft B" })
    expect(state.completed).toBe(false)
    expect(state.rolledBack).toBe(true)
    expect(state.errors).toHaveLength(1)
  })
})
