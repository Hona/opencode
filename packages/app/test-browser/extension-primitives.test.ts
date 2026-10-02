import { describe, expect, test } from "bun:test"
import { createComponent, createRoot, createSignal, onCleanup, type Accessor } from "solid-js"
import { produce } from "solid-js/store"
import { Schema } from "effect"
import {
  createActive,
  createLatest,
  createVisitState,
  ExtensionContext,
  Live,
  Sessions,
  type Context,
  type Persisted,
  type SessionRef,
} from "@opencode/gui-extensions/sdk"
import type { Platform } from "@/runtime/platform/platform"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { createLocatedWrites } from "@/runtime/extension/located"
import { createSessionStore, persistedHandle, whenLoaded } from "@/runtime/extension/stores"

const pending = { status: "pending" } as const

const restarting = { status: "inactive", reason: "restarting" } as const

const first = { status: "active", value: "first", generation: 1 } as const

const second = { status: "active", value: "second", generation: 2 } as const

/** A session the store and layout code can key and locate; they read nothing else. */
function session(key: string, location: Accessor<{ directory: string } | undefined>) {
  const value = {
    key,
    get location() {
      return location()
    },
  }

  // SAFETY: the code under test reads only `key` and `location`, which this value provides.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  return value as unknown as SessionRef
}

describe("extension primitives", () => {
  test.each([
    {
      name: "a Live source runs once per generation and otherwise between them",
      start: () => {
        const [read, write] = createSignal<Live<string>>(pending)

        return {
          source: Live.accessor(read),
          steps: [first, { ...first }, restarting, second, pending].map((step) => () => write(step)),
        }
      },
      expected: [
        "otherwise",
        "end otherwise",
        "run first",
        "end first",
        "otherwise",
        "end otherwise",
        "run second",
        "end second",
        "otherwise",
      ],
    },
    {
      name: "a plain accessor runs once per value identity and otherwise while it is empty",
      start: () => {
        const [read, write] = createSignal<string | undefined>(undefined)

        return {
          source: read,
          steps: ["first", "first", undefined, "second", "third"].map((step) => () => write(step)),
        }
      },
      expected: [
        "otherwise",
        "end otherwise",
        "run first",
        "end first",
        "otherwise",
        "end otherwise",
        "run second",
        "end second",
        "run third",
      ],
    },
  ])("createActive: $name", (row) => {
    const log: string[] = []
    const scenario = row.start()

    const dispose = createRoot((dispose) => {
      createActive(
        scenario.source,
        (value) => {
          log.push(`run ${value}`)
          onCleanup(() => log.push(`end ${value}`))
        },
        {
          otherwise: () => {
            log.push("otherwise")
            onCleanup(() => log.push("end otherwise"))
          },
        },
      )

      return dispose
    })

    scenario.steps.forEach((step) => step())
    expect(log).toEqual(row.expected)
    dispose()
  })

  test("createLatest aborts the previous request and drops its late reply", async () => {
    const [key, setKey] = createSignal<string | undefined>("a")
    const requests = new Map<string, { signal: AbortSignal; reply: PromiseWithResolvers<string> }>()

    const root = createRoot((dispose) => ({
      dispose,
      latest: createLatest(key, (value, signal) => {
        const reply = Promise.withResolvers<string>()

        requests.set(value, { signal, reply })

        return reply.promise
      }),
    }))

    expect(root.latest.loading).toBe(true)
    setKey("b")
    requests.get("b")?.reply.resolve("result b")
    requests.get("a")?.reply.resolve("result a")
    await Bun.sleep(0)
    expect({
      aborted: [requests.get("a")?.signal.aborted, requests.get("b")?.signal.aborted],
      latest: root.latest.latest,
      loading: root.latest.loading,
    }).toEqual({ aborted: [true, false], latest: "result b", loading: false })
    root.dispose()
    expect(requests.get("b")?.signal.aborted).toBe(true)
  })

  test("createVisitState returns to its initial value on every routing visit", () => {
    const [visit, setVisit] = createSignal<object>({})
    const sessions = { list: () => [], current: () => ({ visit: visit() }) }
    const fake = { use: (token: typeof Sessions) => (token === Sessions ? sessions : undefined) }
    // SAFETY: `createVisitState` reads only `use(Sessions).current().visit`, which this fake provides.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
    const context = fake as unknown as Context
    const captured: ReturnType<typeof createVisitState<string>>[] = []

    const dispose = createRoot((dispose) => {
      createComponent(ExtensionContext.Provider, {
        value: context,
        get children() {
          captured.push(createVisitState("initial"))

          return null
        },
      })

      return dispose
    })

    const [value, set] = captured[0] ?? [() => "missing", () => undefined]

    const steps = [
      { action: () => set("chosen"), expected: "chosen" },
      { action: () => setVisit({}), expected: "initial" },
      { action: () => set("again"), expected: "again" },
      { action: () => setVisit({}), expected: "initial" },
    ]

    expect(steps.map((step) => (step.action(), value()))).toEqual(steps.map((step) => step.expected))
    dispose()
  })

  test.each([
    { name: "while the storage read is held", location: { directory: "/repo" } },
    { name: "while the session location is unknown", location: undefined },
  ])("store writes made $name apply in order over the stored value", async (row) => {
    const held = Promise.withResolvers<void>()
    const Items = Schema.Struct({ items: Schema.mutable(Schema.Array(Schema.String)) })
    const key = `extension-store-${crypto.randomUUID()}`

    const platform: Platform = {
      platform: "desktop",
      windowID: "extension-store-test",
      openExternal: () => undefined,
      restart: async () => undefined,
      notify: async () => undefined,
      openDirectoryPickerDialog: async () => null,
      storage: () => ({
        getItem: async () => {
          await held.promise

          return JSON.stringify({ items: ["stored"] })
        },
        setItem: async () => undefined,
        removeItem: async () => undefined,
      }),
    }

    const [location, setLocation] = createSignal<{ directory: string } | undefined>(row.location)
    const opened: Persisted<(typeof Items)["Type"]>[] = []

    const root = createRoot((dispose) => {
      const store = createSessionStore({
        open: () => {
          const pair = persisted(Persist.global(key), Items, { items: [] }, platform)

          const handle = persistedHandle({
            store: pair[0],
            update: (mutation: (draft: (typeof Items)["Type"]) => void) => pair[1](produce(mutation)),
            ready: pair[3],
            init: pair[3].promise,
          })

          opened.push(handle)

          return handle
        },
        owner: null,
      })

      return {
        dispose: () => {
          store.dispose()
          dispose()
        },
        handle: store.get(session("server\nses_store", location)),
      }
    })

    root.handle.update((draft) => void draft.items.push("first"))
    root.handle.update((draft) => void draft.items.push("second"))

    const before = { value: root.handle.value, ready: root.handle.ready() }

    setLocation({ directory: "/repo" })
    held.resolve()
    await Promise.all(opened.map(whenLoaded))
    expect({ before, after: root.handle.value?.items, ready: root.handle.ready() }).toEqual({
      before: { value: undefined, ready: false },
      after: ["stored", "first", "second"],
      ready: true,
    })
    root.dispose()
  })

  test("a layout write held while the session location is unknown runs once, in order, when it is known", () => {
    const [location, setLocation] = createSignal<{ directory: string } | undefined>()
    const target = session("server\nses_layout", location)
    const log: string[] = []
    const root = createRoot((dispose) => ({ dispose, writes: createLocatedWrites() }))

    root.writes.hold(target, () => log.push("open"))
    root.writes.hold(target, () => log.push("scroll"))

    const before = [...log]

    setLocation({ directory: "/repo" })
    setLocation({ directory: "/repo" })
    expect({ before, after: log }).toEqual({ before: [], after: ["open", "scroll"] })
    root.dispose()
  })
})
