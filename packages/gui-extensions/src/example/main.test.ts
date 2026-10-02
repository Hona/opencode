import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Scope, type IpcImpl, type MainContext } from "../sdk/main"
import { Counter } from "./contract"
import setup from "./main"

type Spec = (typeof Counter)["spec"]

/** What an instance provided: the counter, and how often it pushed state to every window. */
type Provided = { counter?: IpcImpl<Spec>; pushed: number }

const caller = { window: 1, signal: new AbortController().signal }

// The guide's example, through its Ipc contract: what the windows see, and what outlives a reload.
test("the example counter pushes every change to the windows and keeps its count across a reload", async () => {
  const disk = new Map<string, string>()
  const first = await start(disk)
  const added = [await first.counter.add(2, caller), await first.counter.add(3, caller)]

  await first.counter.reset(undefined, caller)
  await first.counter.add(4, caller)
  await first.scope.close()

  const second = await start(disk)

  expect({ added, pushed: first.pushed(), reloaded: second.counter.state(caller.window) }).toEqual({
    added: [2, 5],
    pushed: 4,
    reloaded: 4,
  })
})

/** Sets up one instance of the main entry over `disk`, as the main host does, and returns what it provided. */
async function start(disk: Map<string, string>) {
  const scope = Scope.make("example", { timeout: 1_000, log: () => undefined })
  const provided: Provided = { pushed: 0 }

  const ctx: MainContext = {
    id: "example",
    scope,
    storage: {
      store(key, options) {
        const codec = Schema.fromJsonString(Schema.toCodecJson(options.schema))

        const read = () => {
          const raw = disk.get(key)

          return raw === undefined ? options.initial : Schema.decodeUnknownSync(codec)(raw)
        }

        return {
          get value() {
            return read()
          },
          ready: () => true,
          update(mutation) {
            const draft = read()
            const next = mutation(draft)

            disk.set(key, Schema.encodeSync(codec)(next === undefined ? draft : next))
          },
        }
      },
      remove: (key) => void disk.delete(key),
    },
    provide(token, impl) {
      if (token.id !== Counter.id) throw new Error(`The example provides no Ipc "${token.id}"`)
      // SAFETY: the token is `Counter`, checked above, so `impl` implements its spec.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
      provided.counter = impl as unknown as IpcImpl<Spec>

      return { changed: () => void provided.pushed++, emit: () => undefined, dispose: () => undefined }
    },
    add: () => () => undefined,
    list: () => [],
    t: (key) => key,
    plural: (key) => key,
    get log(): never {
      throw unused("log")
    },
    get lifecycle(): never {
      throw unused("lifecycle")
    },
    get build(): never {
      throw unused("build")
    },
    get serverEndpoints(): never {
      throw unused("serverEndpoints")
    },
    get windows(): never {
      throw unused("windows")
    },
    get embeds(): never {
      throw unused("embeds")
    },
    get cli(): never {
      throw unused("cli")
    },
  }

  await setup(ctx)

  const counter = provided.counter

  if (!counter) throw new Error("The example's main entry provided no counter")

  return { scope, counter, pushed: () => provided.pushed }
}

function unused(name: string) {
  return new Error(`The example's main entry reads no ctx.${name}`)
}
