// Attribute a renderer .cpuprofile's self time to original source files through the build's
// source maps. Run with: bun scripts/profile-by-source.ts <profile.cpuprofile> [out/renderer/assets]
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { TraceMap, originalPositionFor } from "C:/Users/Lukem/.local/share/opencode/worktree/6c1049/quiet-wolf-2/node_modules/.bun/@jridgewell+trace-mapping@0.3.31/node_modules/@jridgewell/trace-mapping/dist/trace-mapping.mjs"

const profilePath = process.argv[2]!
const assets = process.argv[3] ?? "out/renderer/assets"
const profile = JSON.parse(readFileSync(profilePath, "utf8"))
const maps = new Map<string, TraceMap>()
for (const name of readdirSync(assets).filter((f) => f.endsWith(".js.map"))) {
  maps.set(name.slice(0, -4), new TraceMap(JSON.parse(readFileSync(join(assets, name), "utf8"))))
}

const nodes = new Map<number, any>()
for (const n of profile.nodes) nodes.set(n.id, n)
const self = new Map<string, number>()
const byPkg = new Map<string, number>()
const group = (source: string) => {
  const n = source.replace(/\\/g, "/")
  const nm = n.match(/node_modules\/(?:\.bun\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)(?:\/dist\/([^/]+))?/)
  if (nm) return nm[1] === "effect" ? `effect/${(nm[2] ?? "").replace(/\.js$/, "")}` : nm[1]
  const pk = n.match(/packages\/([^/]+)\/src\/(.+)$/)
  return pk ? `${pk[1]}/${pk[2]}` : n.slice(-50)
}
let total = 0
for (let i = 0; i < profile.samples.length; i++) {
  const dt = (profile.timeDeltas[i] ?? 0) / 1000
  const node = nodes.get(profile.samples[i])
  const frame = node.callFrame
  const name = frame.functionName
  if (name === "(idle)") continue
  total += dt
  const file = frame.url.split("/").pop()
  const map = maps.get(file)
  const label = (() => {
    if (name === "(program)" || name === "(garbage collector)") return name
    if (!map) return `(no map) ${file}`
    const pos = originalPositionFor(map, { line: frame.lineNumber + 1, column: frame.columnNumber })
    return pos.source ? group(pos.source) : `(unmapped) ${file}`
  })()
  self.set(label, (self.get(label) ?? 0) + dt)
  const pkg = label.split("/").slice(0, label.startsWith("effect/") || label.startsWith("@") ? 2 : 1).join("/")
  byPkg.set(pkg, (byPkg.get(pkg) ?? 0) + dt)
}
console.log(`busy ${total.toFixed(0)} ms\n== by package ==`)
for (const [k, v] of [...byPkg].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(v.toFixed(1).padStart(7), k)
console.log("\n== by source ==")
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 45)) console.log(v.toFixed(1).padStart(7), k)

