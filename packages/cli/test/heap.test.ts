import { Global } from "@opencode-ai/util/global"
import { expect, test } from "bun:test"
import { Effect, Logger } from "effect"
import { mkdir, readdir } from "node:fs/promises"
import path from "node:path"
import { Heap } from "../src/heap"
import { tmpdir } from "./fixture/tmpdir"

test.skipIf(process.platform === "win32")("scopes the Unix heap signal listener", async () => {
  const listeners = process.listenerCount("SIGUSR1")
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Heap.listen
        expect(process.listenerCount("SIGUSR1")).toBe(listeners + 1)
      }),
    ).pipe(Effect.provideService(Global.Service, Global.make())),
  )
  expect(process.listenerCount("SIGUSR1")).toBe(listeners)
})

test.skipIf(process.platform !== "win32")(
  "coalesces Windows event requests without adopting existing events",
  async () => {
    const { createEvent } = await import("#heap-event")
    const name = `Local\\opencode-heap-${process.pid}`
    const event = createEvent(name)
    try {
      expect(event.poll()).toBe(false)
      await signal(process.pid)
      await signal(process.pid)
      expect(event.poll()).toBe(true)
      expect(event.poll()).toBe(false)
      expect(() => createEvent(name)).toThrow("CreateEventW failed: 183")
      expect(event.poll()).toBe(false)

      const messages: unknown[] = []
      await Effect.runPromise(
        Effect.scoped(Heap.listen).pipe(
          Effect.provideService(Global.Service, Global.make()),
          Effect.provide(Logger.layer([Logger.map(Logger.formatStructured, (entry) => messages.push(entry.message))])),
        ),
      )
      expect(messages).toEqual([expect.arrayContaining(["heap snapshot event listener failed"])])
    } finally {
      event.close()
    }
    expect(await signal(process.pid).catch(String)).toBe("Error: OpenEventW failed: 2")
  },
)

test("writes heap snapshots from native signals in a detached process and releases the listener", async () => {
  await using directory = await tmpdir()
  await using child = start(directory.path)
  await child.wait("ready")

  await child.write("ping")
  await child.wait("pong")
  await signal(child.pid)
  await child.wait("heap snapshot written")

  const first = (await readdir(directory.path)).filter((name) => name.endsWith(".heapsnapshot"))
  expect(first).toHaveLength(1)
  expect(first[0]).toStartWith(`heap-${child.pid}-`)
  const snapshot = await Bun.file(path.join(directory.path, first[0])).json()
  expect(snapshot.snapshot.node_count).toBeGreaterThan(0)
  expect(snapshot.snapshot.edge_count).toBeGreaterThan(0)
  expect(snapshot.snapshot.meta.node_fields).toContain("self_size")

  await signal(child.pid)
  await child.wait("heap snapshot written", 2)
  expect((await readdir(directory.path)).filter((name) => name.endsWith(".heapsnapshot"))).toHaveLength(2)

  await child.write("close")
  await child.wait("closed:0")
  if (process.platform === "win32") expect(await signal(child.pid).catch(String)).toBe("Error: OpenEventW failed: 2")
  await child.write("ping")
  await child.wait("pong", 2)
  await child.write("exit")
  expect(await child.exited).toBe(0)
}, 30_000)

test("continues accepting native signals after a snapshot write fails", async () => {
  await using directory = await tmpdir()
  const log = path.join(directory.path, "missing")
  await using child = start(log)
  await child.wait("ready")

  await signal(child.pid)
  await child.wait("failed to write heap snapshot")
  await mkdir(log)
  await signal(child.pid)
  await child.wait("heap snapshot written")
  expect((await readdir(log)).filter((name) => name.endsWith(".heapsnapshot"))).toHaveLength(1)

  await child.write("exit")
  expect(await child.exited).toBe(0)
}, 30_000)

function start(log: string) {
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixture/heap.ts"), log], {
    detached: true,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  const output = { text: "" }
  const stdout = (async () => {
    const decoder = new TextDecoder()
    for await (const chunk of child.stdout) output.text += decoder.decode(chunk, { stream: true })
  })()
  const stderr = new Response(child.stderr).text()
  return {
    pid: child.pid,
    exited: child.exited,
    async write(line: string) {
      await child.stdin.write(`${line}\n`)
      await child.stdin.flush()
    },
    async wait(text: string, count = 1) {
      const deadline = Date.now() + 15_000
      while (output.text.split(text).length - 1 < count) {
        if (child.exitCode !== null) throw new Error(`Fixture exited: ${output.text}\n${await stderr}`)
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${text}: ${output.text}`)
        await Bun.sleep(20)
      }
    },
    async [Symbol.asyncDispose]() {
      if (child.exitCode === null) child.kill()
      await Promise.all([child.exited, stdout, stderr])
    },
  }
}

async function signal(pid: number) {
  if (process.platform !== "win32") {
    process.kill(pid, "SIGUSR1")
    return
  }
  const { dlopen } = await import("bun:ffi")
  const library = dlopen("kernel32.dll", {
    OpenEventW: { args: ["u32", "i32", "ptr"], returns: "u64" },
    SetEvent: { args: ["u64"], returns: "i32" },
    CloseHandle: { args: ["u64"], returns: "i32" },
    GetLastError: { args: [], returns: "u32" },
  })
  try {
    const handle = library.symbols.OpenEventW(0x2, 0, Buffer.from(`Local\\opencode-heap-${pid}\0`, "utf16le"))
    if (!handle) throw new Error(`OpenEventW failed: ${library.symbols.GetLastError()}`)
    try {
      if (!library.symbols.SetEvent(handle)) throw new Error(`SetEvent failed: ${library.symbols.GetLastError()}`)
    } finally {
      library.symbols.CloseHandle(handle)
    }
  } finally {
    library.close()
  }
}
