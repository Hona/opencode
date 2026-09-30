import { afterEach, expect, jest, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import type { RemoteClient } from "../sdk"
import { createConnection } from "./connection"
import type { BrowserPane, PaneEvent } from "./remote"

type Input = Parameters<typeof createConnection>[0]
type State = Parameters<Input["change"]>[0]
type Client = RemoteClient<(typeof BrowserPane)["spec"]>

const tabID = Browser.TabID.make(`tab_${crypto.randomUUID()}`)
const browser: Browser.State = {
  tabs: [
    {
      id: tabID,
      url: "http://localhost:4173/",
      title: "Preview",
      loading: false,
      canGoBack: true,
      canGoForward: false,
      generation: 3,
    },
  ],
  focusedTabID: tabID,
}

afterEach(() => {
  jest.useRealTimers()
})

// The client stands in for the pane's main entry: each register is one binding with its own events.
function fixture() {
  const states: State[] = []
  const listeners = new Map<string, (event: PaneEvent) => void>()
  const calls: { input: Parameters<Client["register"]>[0]; commands: Browser.Action[] }[] = []
  const closed: string[] = []
  const highlights: { binding: string; tabID: Browser.TabID; ref?: Browser.Ref }[] = []
  const routed: Record<"preview" | "inspect" | "focus", unknown[]> = {
    preview: [],
    inspect: [],
    focus: [],
  }
  const target = { server: "browser-test", session: "ses_browser" }
  const client: Client = {
    register: async (input) => {
      calls.push({ input, commands: [] })
    },
    load: async () => undefined,
    command: async (input) => {
      calls.find((call) => call.input.binding === input.binding)?.commands.push(input.command)
    },
    inspect: async () => undefined,
    highlight: async (input) => {
      highlights.push(input)
    },
    close: async (input) => {
      closed.push(input.binding)
    },
    state: () => undefined,
    on: () => () => undefined,
  }
  const connection = createConnection({
    client: () => client,
    listen(binding, listener) {
      listeners.set(binding, listener)
      return () => listeners.delete(binding)
    },
    target: () => ({ ...target }),
    change: (state) => states.push(state),
    focus: (tabID) => routed.focus.push(tabID),
    preview: (path) => routed.preview.push(path),
    inspect: (event) => routed.inspect.push(event),
  })
  const emit = (index: number, event: PaneEvent) => listeners.get(calls[index].input.binding)?.(event)
  connection.wake()
  emit(0, { type: "state", state: browser })
  return { connection, calls, states, target, routed, highlights, closed, listeners, emit }
}

const element = {
  ref: Browser.Ref.make("e4"),
  selector: "#save",
  label: "button#save",
  rect: { x: 1, y: 2, width: 3, height: 4 },
}
test.each([
  { route: "preview" as const, event: { type: "preview", path: "docs/report.pdf" } as const, value: "docs/report.pdf" },
  { route: "focus" as const, event: { type: "focus", tabID } as const, value: tabID },
  {
    route: "inspect" as const,
    event: { type: "inspect", tabID, active: false, element } as const,
    value: { type: "inspect", tabID, active: false, element },
  },
])("$route events reach the session without touching connection state", ({ route, event, value }) => {
  const app = fixture()
  try {
    const before = app.states.length
    app.emit(0, event)
    expect(app.routed[route]).toEqual([value])
    expect(app.states).toHaveLength(before)
  } finally {
    app.connection.dispose()
  }
})

test("highlights of picked elements reach the page", async () => {
  const app = fixture()
  try {
    app.connection.highlight(tabID, element.ref)
    app.connection.highlight(tabID)
    await Bun.sleep(0)
    const binding = app.calls[0].input.binding
    expect(app.highlights).toEqual([
      { binding, tabID, ref: element.ref },
      { binding, tabID },
    ])
  } finally {
    app.connection.dispose()
  }
})

test("suspension retains tabs and reconnects once on demand using the current target", () => {
  jest.useFakeTimers()
  const app = fixture()
  try {
    app.emit(0, { type: "state", state: browser, error: "browser.pane.suspended" })
    expect(app.listeners.has(app.calls[0].input.binding)).toBe(false)
    expect(app.states.at(-1)).toMatchObject({ registration: undefined, browser, suspended: true })
    // A suspended attachment must not schedule the transport retry.
    jest.advanceTimersByTime(30_000)
    expect(app.calls).toHaveLength(1)
    app.target.server = "browser-moved"
    app.connection.wake()
    app.connection.wake()
    expect(app.calls).toHaveLength(2)
    expect(app.calls[1].input).toEqual({
      binding: expect.any(String),
      server: "browser-moved",
      session: "ses_browser",
      restore: browser,
    })
    expect(app.states.at(-1)?.suspended).toBe(false)
    app.emit(0, { type: "state", state: null, error: "browser.pane.registration.closed" })
    expect(app.states.at(-1)?.registration).toBeDefined()
  } finally {
    app.connection.dispose()
  }
})

test("a command wakes its attachment once and is not replayed", async () => {
  const app = fixture()
  try {
    app.emit(0, { type: "state", state: browser, error: "browser.pane.suspended" })
    await app.connection.command({ type: "reload", tabID })
    expect(app.calls).toHaveLength(2)
    expect(app.calls[1].commands).toEqual([{ type: "reload", tabID }])
    app.connection.dispose()
    app.connection.wake()
    await Bun.sleep(0)
    expect(app.closed).toEqual([app.calls[0].input.binding, app.calls[1].input.binding])
    expect(app.calls).toHaveLength(2)
  } finally {
    app.connection.dispose()
  }
})

test.each(["browser.pane.replaced", "browser.pane.unsupported"])("%s blocks automatic ownership recovery", (error) => {
  const app = fixture()
  try {
    app.emit(0, { type: "state", state: null, error })
    app.connection.wake()
    expect(app.calls).toHaveLength(1)
    expect(app.states.at(-1)?.error).toBe(error)
  } finally {
    app.connection.dispose()
  }
})
