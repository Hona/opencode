#!/usr/bin/env bun

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const args = process.argv.slice(2)
const stop = args.indexOf("--")

if (stop === -1) {
  throw new Error("Usage: bun script/metrics.ts [--name <name>] [--out <file>] [--cwd <dir>] [--step <ms>] -- <command...>")
}

const head = args.slice(0, stop)
const tail = args.slice(stop + 1)

if (!tail.length) {
  throw new Error("Missing command after --")
}

let name = "run"
let out = ""
let cwd = process.cwd()
let step = 1000

for (let i = 0; i < head.length; i++) {
  const arg = head[i]
  if (arg === "--name") {
    name = head[++i] ?? "run"
    continue
  }
  if (arg === "--out") {
    out = head[++i] ?? ""
    continue
  }
  if (arg === "--cwd") {
    cwd = path.resolve(head[++i] ?? cwd)
    continue
  }
  if (arg === "--step") {
    step = Number(head[++i] ?? step)
    continue
  }
  throw new Error(`Unknown arg: ${arg}`)
}

if (!Number.isFinite(step) || step < 250) {
  throw new Error(`Invalid step: ${step}`)
}

if (!out) {
  out = path.join("tmp", "metrics", `${name.replace(/[^a-z0-9._-]+/gi, "-").toLowerCase()}.json`)
}

const root = path.resolve(import.meta.dir, "..")
const file = path.resolve(root, out)

function pct(n: number) {
  return `${n.toFixed(1)}%`
}

function mb(n: number) {
  return `${(n / 1024 / 1024).toFixed(1)} MB/s`
}

function sec(n: number) {
  return `${(n / 1000).toFixed(1)}s`
}

function vals(list: Array<number | null | undefined>) {
  return list.filter((x): x is number => typeof x === "number" && Number.isFinite(x))
}

function avg(list: Array<number | null | undefined>) {
  const xs = vals(list)
  if (!xs.length) return null
  return xs.reduce((sum, x) => sum + x, 0) / xs.length
}

function max(list: Array<number | null | undefined>) {
  const xs = vals(list)
  if (!xs.length) return null
  return Math.max(...xs)
}

function p95(list: Array<number | null | undefined>) {
  const xs = vals(list).sort((a, b) => a - b)
  if (!xs.length) return null
  return xs[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)]
}

function fmt(n: number | null, unit: (n: number) => string) {
  return n === null ? "n/a" : unit(n)
}

function snapcpu() {
  return os.cpus().reduce(
    (sum, cpu) => ({
      idle: sum.idle + cpu.times.idle,
      total: sum.total + Object.values(cpu.times).reduce((acc, x) => acc + x, 0),
    }),
    { idle: 0, total: 0 },
  )
}

function cpuuse(prev: ReturnType<typeof snapcpu>, next: ReturnType<typeof snapcpu>) {
  const total = next.total - prev.total
  if (total <= 0) return null
  return Math.max(0, Math.min(100, ((total - (next.idle - prev.idle)) / total) * 100))
}

async function linuxdisk() {
  const snap = async () => {
    const txt = await Bun.file("/proc/diskstats").text()
    return txt
      .split(/\r?\n/)
      .flatMap((line) => {
        const part = line.trim().split(/\s+/)
        const name = part[2]
        if (!name || !diskok(name)) return []
        return [
          {
            read: Number(part[5] ?? 0) * 512,
            write: Number(part[9] ?? 0) * 512,
            busy: Number(part[12] ?? 0),
            wait: Number(part[13] ?? 0),
          },
        ]
      })
      .reduce(
        (sum, part) => ({
          read: sum.read + part.read,
          write: sum.write + part.write,
          busy: sum.busy + part.busy,
          wait: sum.wait + part.wait,
        }),
        { read: 0, write: 0, busy: 0, wait: 0 },
      )
  }

  let prev = await snap()
  let last = Date.now()

  return {
    async read() {
      const next = await snap()
      const now = Date.now()
      const span = now - last
      last = now

      const read = next.read - prev.read
      const write = next.write - prev.write
      const busy = next.busy - prev.busy
      const wait = next.wait - prev.wait
      prev = next

      if (span <= 0) return null

      return {
        read: (read * 1000) / span,
        write: (write * 1000) / span,
        busy: Math.max(0, Math.min(100, (busy / span) * 100)),
        queue: Math.max(0, wait / span),
      }
    },
    async stop() {},
  }
}

function diskok(name: string) {
  if (/^(loop|ram|fd|sr|dm-|md|zram)/.test(name)) return false
  if (/^nvme\d+n\d+$/.test(name)) return true
  if (/^nvme\d+n\d+p\d+$/.test(name)) return false
  if (/^mmcblk\d+$/.test(name)) return true
  if (/^mmcblk\d+p\d+$/.test(name)) return false
  return !/\d+$/.test(name)
}

async function windisk() {
  const args = [
    "typeperf",
    "\\PhysicalDisk(_Total)\\Disk Read Bytes/sec",
    "\\PhysicalDisk(_Total)\\Disk Write Bytes/sec",
    "\\PhysicalDisk(_Total)\\% Disk Time",
    "\\PhysicalDisk(_Total)\\Current Disk Queue Length",
    "-si",
    String(Math.max(1, Math.round(step / 1000))),
  ]

  const proc = Bun.spawn(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })

  let buf = ""
  let last: { read: number; write: number; busy: number; queue: number } | null = null

  const parse = (line: string) => {
    const part = [...line.matchAll(/"([^"]*)"/g)].map((x) => x[1])
    if (part.length < 5 || part[0].startsWith("(PDH-CSV")) return

    const read = Number(part[1])
    const write = Number(part[2])
    const busy = Number(part[3])
    const queue = Number(part[4])

    if ([read, write, busy, queue].some((x) => !Number.isFinite(x))) return

    last = {
      read,
      write,
      busy: Math.max(0, Math.min(100, busy)),
      queue: Math.max(0, queue),
    }
  }

  const pump = (async () => {
    if (!proc.stdout) return
    const stream = proc.stdout.pipeThrough(new TextDecoderStream())
    for await (const chunk of stream) {
      buf += chunk
      let idx = buf.indexOf("\n")
      while (idx !== -1) {
        parse(buf.slice(0, idx).trim())
        buf = buf.slice(idx + 1)
        idx = buf.indexOf("\n")
      }
    }
    parse(buf.trim())
  })()

  const err = proc.stderr ? new Response(proc.stderr).text() : Promise.resolve("")

  return {
    async read() {
      return last
    },
    async stop() {
      if (proc.exitCode === null) proc.kill()
      await Promise.allSettled([proc.exited, pump])
      const msg = (await err).trim()
      if (msg && !msg.includes("The command completed successfully")) {
        console.warn(msg)
      }
    },
  }
}

async function nodisk() {
  return {
    async read() {
      return null
    },
    async stop() {},
  }
}

const disk =
  process.platform === "linux"
    ? await linuxdisk().catch(() => nodisk())
    : process.platform === "win32"
      ? await windisk().catch(() => nodisk())
      : await nodisk()

const proc = Bun.spawn(tail, {
  cwd,
  env: process.env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

const started = Date.now()
const info = {
  name,
  cwd,
  cmd: tail,
  step,
  platform: process.platform,
  cpu: os.cpus().length,
  env: {
    ci: process.env.CI ?? "",
    runner: process.env.RUNNER_OS ?? "",
    workers: process.env.PLAYWRIGHT_WORKERS ?? "",
  },
}

let prev = snapcpu()
const list: Array<{
  at: number
  cpu: number | null
  mem: number
  mem_bytes: number
  read: number | null
  write: number | null
  busy: number | null
  queue: number | null
}> = []

const loop = (async () => {
  while (proc.exitCode === null) {
    await Bun.sleep(step)
    const next = snapcpu()
    const total = os.totalmem()
    const free = os.freemem()
    const mem = total > 0 ? ((total - free) / total) * 100 : 0
    const io = await disk.read()

    list.push({
      at: Date.now(),
      cpu: cpuuse(prev, next),
      mem,
      mem_bytes: total - free,
      read: io?.read ?? null,
      write: io?.write ?? null,
      busy: io?.busy ?? null,
      queue: io?.queue ?? null,
    })

    prev = next
  }
})()

const code = await proc.exited
await loop
await disk.stop()

const ended = Date.now()
const data = {
  ...info,
  started,
  ended,
  duration: ended - started,
  code,
  stats: {
    cpu: {
      avg: avg(list.map((x) => x.cpu)),
      p95: p95(list.map((x) => x.cpu)),
      max: max(list.map((x) => x.cpu)),
    },
    mem: {
      avg: avg(list.map((x) => x.mem)),
      p95: p95(list.map((x) => x.mem)),
      max: max(list.map((x) => x.mem)),
      peak_bytes: max(list.map((x) => x.mem_bytes)),
    },
    disk: {
      read_avg: avg(list.map((x) => x.read)),
      read_p95: p95(list.map((x) => x.read)),
      write_avg: avg(list.map((x) => x.write)),
      write_p95: p95(list.map((x) => x.write)),
      busy_avg: avg(list.map((x) => x.busy)),
      busy_p95: p95(list.map((x) => x.busy)),
      busy_max: max(list.map((x) => x.busy)),
      queue_avg: avg(list.map((x) => x.queue)),
      queue_p95: p95(list.map((x) => x.queue)),
      queue_max: max(list.map((x) => x.queue)),
    },
  },
  samples: list,
}

await fs.mkdir(path.dirname(file), { recursive: true })
await Bun.write(file, `${JSON.stringify(data, null, 2)}\n`)

const lines = [
  `metrics: ${name}`,
  `duration: ${sec(data.duration)}`,
  `cpu: avg ${fmt(data.stats.cpu.avg, pct)} | p95 ${fmt(data.stats.cpu.p95, pct)} | max ${fmt(data.stats.cpu.max, pct)}`,
  `mem: avg ${fmt(data.stats.mem.avg, pct)} | p95 ${fmt(data.stats.mem.p95, pct)} | max ${fmt(data.stats.mem.max, pct)} | peak ${fmt(data.stats.mem.peak_bytes, (n) => `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`)}`,
  `disk read: avg ${fmt(data.stats.disk.read_avg, mb)} | p95 ${fmt(data.stats.disk.read_p95, mb)}`,
  `disk write: avg ${fmt(data.stats.disk.write_avg, mb)} | p95 ${fmt(data.stats.disk.write_p95, mb)}`,
  `disk busy: avg ${fmt(data.stats.disk.busy_avg, pct)} | p95 ${fmt(data.stats.disk.busy_p95, pct)} | max ${fmt(data.stats.disk.busy_max, pct)}`,
  `disk queue: avg ${fmt(data.stats.disk.queue_avg, (n) => n.toFixed(2))} | p95 ${fmt(data.stats.disk.queue_p95, (n) => n.toFixed(2))} | max ${fmt(data.stats.disk.queue_max, (n) => n.toFixed(2))}`,
  `samples: ${list.length}`,
  `out: ${path.relative(root, file)}`,
  code === 0 ? "result: wrapped command passed" : `result: wrapped command failed with exit ${code}`,
  code === 0 ? "wrapper: metrics captured successfully" : "wrapper: metrics captured successfully and the wrapped command exit code is being propagated",
]

console.log(`\n${lines.join("\n")}`)

if (process.env.GITHUB_STEP_SUMMARY) {
  const body = [
    `## ${name}`,
    "",
    `- command: \`${tail.join(" ")}\``,
    `- cwd: \`${path.relative(root, cwd) || "."}\``,
    `- duration: ${sec(data.duration)}`,
    code === 0 ? "- result: wrapped command passed" : `- result: wrapped command failed with exit ${code}`,
    code === 0
      ? "- wrapper: metrics captured successfully"
      : "- wrapper: metrics captured successfully and propagated the wrapped command exit code",
    "",
    "| metric | avg | p95 | max |",
    "| --- | ---: | ---: | ---: |",
    `| CPU % | ${fmt(data.stats.cpu.avg, (n) => n.toFixed(1))} | ${fmt(data.stats.cpu.p95, (n) => n.toFixed(1))} | ${fmt(data.stats.cpu.max, (n) => n.toFixed(1))} |`,
    `| Memory % | ${fmt(data.stats.mem.avg, (n) => n.toFixed(1))} | ${fmt(data.stats.mem.p95, (n) => n.toFixed(1))} | ${fmt(data.stats.mem.max, (n) => n.toFixed(1))} |`,
    `| Disk busy % | ${fmt(data.stats.disk.busy_avg, (n) => n.toFixed(1))} | ${fmt(data.stats.disk.busy_p95, (n) => n.toFixed(1))} | ${fmt(data.stats.disk.busy_max, (n) => n.toFixed(1))} |`,
    `| Disk queue | ${fmt(data.stats.disk.queue_avg, (n) => n.toFixed(2))} | ${fmt(data.stats.disk.queue_p95, (n) => n.toFixed(2))} | ${fmt(data.stats.disk.queue_max, (n) => n.toFixed(2))} |`,
    "",
    "| throughput | avg | p95 |",
    "| --- | ---: | ---: |",
    `| Read MB/s | ${fmt(data.stats.disk.read_avg, (n) => (n / 1024 / 1024).toFixed(1))} | ${fmt(data.stats.disk.read_p95, (n) => (n / 1024 / 1024).toFixed(1))} |`,
    `| Write MB/s | ${fmt(data.stats.disk.write_avg, (n) => (n / 1024 / 1024).toFixed(1))} | ${fmt(data.stats.disk.write_p95, (n) => (n / 1024 / 1024).toFixed(1))} |`,
    "",
  ].join("\n")

  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `${body}\n`)
}

process.exit(code)
