// Baseline = upstream/v2 storage path (electron-store's `conf` + atomically, old drafts.ts).
// Candidate = this PR's modules. Same operations, same machine, temp dirs under userData-like paths.
import { mkdtempSync, rmSync, statSync, readFileSync, unlinkSync } from "node:fs"
import path from "node:path"
import Conf from "../../node_modules/.bun/node_modules/conf/dist/source/index.js"
import { createDesktopDraftStore } from "./drafts.v2.tmp"
import { openDatabase } from "./src/main/storage/database"
import { createStateStore } from "./src/main/storage/state"
import { createDraftStore } from "./src/main/storage/drafts"

type Stats = { median: number; p95: number; max: number }
const stats = (samples: number[]): Stats => {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
  return { median: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1]! }
}
const fmt = (ms: number) => (ms < 1 ? `${(ms * 1000).toFixed(0)} µs` : `${ms.toFixed(2)} ms`)
const row = (label: string, a: Stats, b: Stats) =>
  console.log(`| ${label} | ${fmt(a.median)} / ${fmt(a.p95)} / ${fmt(a.max)} | ${fmt(b.median)} / ${fmt(b.p95)} / ${fmt(b.max)} |`)
const measure = (fn: () => void, runs: number) => {
  const samples: number[] = []
  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    fn()
    samples.push(performance.now() - start)
  }
  return stats(samples)
}

const root = mkdtempSync(path.join("C:/tmp/opencode", "bench-"))
const dir = (name: string) => {
  const target = path.join(root, name)
  return target
}

// ---- baseline: conf, exactly as getStore() configures electron-store
const stores = new Map<string, Conf>()
const getStore = (cwd: string, name: string) => {
  const cached = stores.get(name)
  if (cached) return cached
  const next = new Conf({ projectName: "bench", cwd, configName: name, fileExtension: "", accessPropertiesByDotNotation: false })
  stores.set(name, next)
  return next
}
const removeStoreFileIfEmpty = (cwd: string, name: string) => {
  const file = path.join(cwd, name)
  try {
    if (statSync(file).size > 128) return
    const raw = readFileSync(file, "utf8")
    if (raw.trim() === "" || Object.keys(JSON.parse(raw)).length === 0) {
      unlinkSync(file)
      stores.delete(name)
    }
  } catch {}
}
const baseline = (cwd: string) => ({
  set: (name: string, key: string, value: string) => getStore(cwd, name).set(key, value),
  delete: (name: string, key: string) => {
    getStore(cwd, name).delete(key)
    removeStoreFileIfEmpty(cwd, name)
  },
  get: (name: string, key: string) => {
    const value = getStore(cwd, name).get(key)
    return value === undefined ? null : typeof value === "string" ? value : JSON.stringify(value)
  },
})

const payload = (f: number, k: number) => JSON.stringify({ f, k, pad: "x".repeat(512) })
const RUNS = 200

// 1. tab close: what the IPC handlers execute synchronously on the main thread
const b1 = baseline(dir("baseline-close"))
const closeBaseline = measure(() => {
  for (let k = 0; k < 6; k++) b1.set("opencode.window.w.dat", `tabs.${k}`, payload(1, k))
  b1.delete("opencode.draft.a.dat", "draft:prompt")
  b1.delete("opencode.draft.a.dat", "draft:layout")
}, RUNS)
const dbClose = openDatabase(path.join(root, "candidate-close.sqlite"))
const c1 = createStateStore(dbClose.db, { delay: 1e9 })
const closeCandidate = measure(() => {
  for (let k = 0; k < 6; k++) c1.set("opencode.window.w.dat", `tabs.${k}`, payload(1, k))
  c1.delete("opencode.draft.a.dat", "draft:prompt")
  c1.delete("opencode.draft.a.dat", "draft:layout")
}, RUNS)
// candidate deferred cost: the flush that runs 250 ms later
const flushCandidate = measure(() => {
  for (let k = 0; k < 6; k++) c1.set("opencode.window.w.dat", `tabs.${k}`, payload(2, k))
  c1.delete("opencode.draft.a.dat", "draft:prompt")
  c1.delete("opencode.draft.a.dat", "draft:layout")
  c1.flush()
}, RUNS)

// 2. single set to a 30-key namespace (layout drag frame)
const b2 = baseline(dir("baseline-set"))
for (let k = 0; k < 30; k++) b2.set("opencode.global.dat", `key.${k}`, payload(0, k))
const setBaseline = measure(() => b2.set("opencode.global.dat", "layout", payload(3, 0)), 500)
const c2 = createStateStore(dbClose.db, { delay: 1e9 })
for (let k = 0; k < 30; k++) c2.set("opencode.global.dat", `key.${k}`, payload(0, k))
c2.flush()
const setCandidate = measure(() => c2.set("opencode.global.dat", "layout", payload(3, 0)), 500)

// 3. get from a 30-key namespace
const getBaseline = measure(() => b2.get("opencode.global.dat", "key.7"), 2000)
const getCandidate = measure(() => c2.get("opencode.global.dat", "key.7"), 2000)

// 4. draft store open (blob GC) over 2000 docs, 500 blobs
const seed = (set: (k: string, v: string) => void, put: (d: Uint8Array) => string) => {
  const ids: string[] = []
  for (let i = 0; i < 500; i++) ids.push(put(new Uint8Array([i & 255, i >> 8, 7])))
  for (let i = 0; i < 2000; i++) {
    const parts = [{ type: "text", content: "y".repeat(900) }, ...(i % 8 === 0 ? [{ type: "image", blob: { id: ids[i % 250]! } }] : [])]
    set(`opencode.workspace.${i}.dat:session:${i}:prompt`, JSON.stringify({ prompt: parts }))
  }
}
const oldFile = path.join(root, "baseline-drafts.sqlite")
const oldDrafts = createDesktopDraftStore(oldFile)
seed(oldDrafts.set, oldDrafts.putBlob)
oldDrafts.flush()
const gcBaseline = measure(() => createDesktopDraftStore(oldFile).close(), 7)
const dbDrafts = openDatabase(path.join(root, "candidate-drafts.sqlite"))
const newDrafts = createDraftStore(dbDrafts.db, { delay: 1e9 })
seed(newDrafts.set, newDrafts.putBlob)
newDrafts.flush()
const gcCandidate = measure(() => createDraftStore(dbDrafts.db, { delay: 1e9 }), 7)

console.log(`| Operation (main thread, sync) | Baseline \`upstream/v2\` median / p95 / max | PR median / p95 / max |`)
console.log(`| --- | --- | --- |`)
row("Tab close: 6 sets + 2 deletes, as executed by the IPC handlers", closeBaseline, closeCandidate)
row("Tab close incl. the deferred flush (PR only pays this 250 ms later)", closeBaseline, flushCandidate)
row("Single `set` into a 30-key namespace (layout drag frame)", setBaseline, setCandidate)
row("Single `get` from a 30-key namespace", getBaseline, getCandidate)
row("Draft store open: blob GC over 2 000 documents", gcBaseline, gcCandidate)

dbClose.close()
dbDrafts.close()
try {
  rmSync(root, { recursive: true, force: true })
} catch {}
