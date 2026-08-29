import { fullGC, heapStats } from "bun:jsc"
import { Effect, Layer, Logger, ManagedRuntime } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { Environment } from "@opencode-ai/core/environment/index"
import { Location } from "@opencode-ai/core/location"
import { Shell } from "@opencode-ai/core/shell"
import { Global } from "@opencode-ai/util/global"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { hostEnvironmentLayer } from "./environment"
import { tempGlobalLayer } from "./global"
import { tempLocationLayer } from "./location"

const mode = process.argv[2] ?? "exit"
const bytes = Number(process.argv[3] ?? 1024 * 1024)
const iterations = Number(process.argv[4] ?? 1)
const gc = { rounds: 8, intervalMs: 100 }
const executable =
  (process.platform === "win32"
    ? iterations > 1
      ? Bun.which("cmd")
      : (Bun.which("pwsh") ?? Bun.which("powershell"))
    : Bun.which("sh")) ?? undefined
if (!executable) throw new Error("Shell retention fixture requires PowerShell or sh")
if (
  !["exit", "timeout", "no-timeout"].includes(mode) ||
  !Number.isSafeInteger(bytes) ||
  bytes < 1 ||
  !Number.isSafeInteger(iterations) ||
  iterations < 1 ||
  (iterations > 1 && mode !== "exit")
) {
  throw new Error("Expected exit, timeout, or no-timeout and a positive byte count")
}

const layer = LayerNode.compile(Shell.node, [
  [Location.node, tempLocationLayer],
  [Environment.node, hostEnvironmentLayer],
  [Global.node, tempGlobalLayer],
  [Database.node, Database.configured({ path: ":memory:" })],
]).pipe(Layer.provide(Logger.layer([])))

await using runtime = ManagedRuntime.make(layer)
const shell = await runtime.runPromise(Shell.Service)
// Warm process and file I/O before the two measured checkpoints.
const warm = await runtime.runPromise(shell.create({ command: "echo warm", shell: executable, timeout: 30_000 }))
await runtime.runPromise(shell.wait(warm.id))
await runtime.runPromise(shell.remove(warm.id))
await collect()
const before = memory()
const probes = []
for (let i = 0; i < iterations; i++) {
  probes.push(await run(shell))
  if (iterations > 1 && (i + 1) % 100 === 0) console.error(`Completed ${i + 1}/${iterations} shell commands`)
}
const probe = probes[probes.length - 1]
await collect()
const after = memory()
const retained = alive(probe.reference)
const controlRetained = alive(probe.control)
const retainedCount = probes.filter((item) => alive(item.reference)).length
const controlRetainedCount = probes.filter((item) => alive(item.control)).length
const history = await runtime.runPromise(shell.get(probe.info.id))
const waited = await runtime.runPromise(shell.wait(probe.info.id))
const output = await runtime.runPromise(shell.output(probe.info.id, { limit: 16 }))
const unchanged = await runtime.runPromise(shell.timeout(probe.info.id, 1))
const running = await runtime.runPromise(shell.list())
await runtime.runPromise(shell.remove(probe.info.id))
await collect()
console.log(
  JSON.stringify({
    mode,
    bytes,
    iterations,
    workload: iterations > 1 ? "captured-context" : "shell-output",
    executable,
    bun: Bun.version,
    platform: process.platform,
    gc,
    before,
    after,
    retained,
    controlRetained,
    retainedCount,
    controlRetainedCount,
    releasedAfterRemoval: !alive(probe.reference),
    status: history.status,
    outputSize: output.size,
    outputPrefix: output.output,
    waitMatchesHistory: waited === history,
    timeoutLeavesHistoryUnchanged: unchanged === history,
    running: running.length,
  }),
)

async function run(shell: Shell.Interface) {
  const sentinel = { output: iterations > 1 ? Buffer.alloc(bytes, "x") : "", called: false }
  const command =
    iterations > 1
      ? "echo sentinel"
      : process.platform === "win32"
        ? `[Console]::Out.Write(('x' * ${bytes})); ${mode === "timeout" ? "Start-Sleep -Seconds 30" : ""}`
        : `head -c ${bytes} /dev/zero | tr '\\0' x${mode === "timeout" ? "; sleep 30" : ""}`
  const info = await Effect.runPromise(
    shell.create({ command, shell: executable, timeout: mode === "exit" ? 30_000 : 0 }, () =>
      Effect.sync(() => {
        sentinel.called = true
      }),
    ),
  )
  if (mode === "timeout") {
    const deadline = Date.now() + 15_000
    while ((await Effect.runPromise(shell.output(info.id, { cursor: Number.MAX_SAFE_INTEGER }))).size < bytes) {
      if (Date.now() > deadline) throw new Error("Shell did not produce the sentinel output")
      await Bun.sleep(20)
    }
    await Effect.runPromise(shell.timeout(info.id, 20))
  }
  await Effect.runPromise(shell.wait(info.id))
  const output = await Effect.runPromise(shell.output(info.id, { limit: iterations > 1 ? 64 : bytes }))
  const valid =
    iterations > 1
      ? output.output.trim() === "sentinel" && sentinel.output.length === bytes
      : output.output.length === bytes && output.output[0] === "x" && output.output.at(-1) === "x"
  if (!sentinel.called || !valid) {
    throw new Error(
      `Preflight or sentinel output did not complete: ${JSON.stringify({ called: sentinel.called, size: output.size, output: output.output.slice(0, 200) })}`,
    )
  }
  // Single-command tests use real output; the stress run captures a distinct buffer per invocation.
  if (iterations === 1) sentinel.output = output.output
  return { info, reference: new WeakRef(sentinel), control: new WeakRef({ output: sentinel.output }) }
}

async function collect() {
  // WeakRef targets are kept alive until the current job ends. Do not dereference between GC rounds.
  for (let i = 0; i < gc.rounds; i++) {
    await Bun.sleep(gc.intervalMs)
    fullGC()
  }
  await Bun.sleep(0)
}

function alive(reference: WeakRef<object>) {
  // Do not leave the dereferenced target in a suspended generator's temporary registers.
  return reference.deref() !== undefined
}

function memory() {
  const heap = heapStats()
  return { heapSize: heap.heapSize, extraMemorySize: heap.extraMemorySize, rss: process.memoryUsage().rss }
}
