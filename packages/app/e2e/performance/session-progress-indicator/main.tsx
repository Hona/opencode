import { render } from "solid-js/web"
import { SessionProgressIndicatorV2 } from "@opencode-ai/session-ui/v2/session-progress-indicator-v2"
import { createSignal, onCleanup, Show } from "solid-js"

const search = new URLSearchParams(location.search)
const requestedCount = search.has("count") ? Number(search.get("count")) : undefined
const initialMode = search.get("mode") === "legacy" ? "legacy" : "mask"
const benchmark = search.has("benchmark")
const [mode, setMode] = createSignal<"legacy" | "mask">(initialMode)
const measure = () => ({
  columns: Math.max(1, Math.floor((innerWidth + 4) / 20)),
  rows: Math.max(1, Math.floor((innerHeight + 4) / 20)),
})
const [grid, setGrid] = createSignal(measure())
const capacity = () => grid().columns * grid().rows
const count = () => requestedCount ?? capacity()
const columns = () => (requestedCount === 200 ? 20 : requestedCount === 800 ? 40 : grid().columns)
const rows = () => (requestedCount === 200 ? 10 : requestedCount === 800 ? 20 : grid().rows)
const size = () => {
  if (requestedCount === 200)
    return Math.max(16, Math.min(32, (innerWidth / columns()) * 0.6, (innerHeight / rows()) * 0.6))
  if (requestedCount === 800)
    return Math.max(16, Math.min(24, (innerWidth / columns()) * 0.7, (innerHeight / rows()) * 0.7))
  return 16
}
addEventListener("resize", () => setGrid(measure()))
const opacity = [0.2, 0.5, 0.75, 1]
const poses = [
  "0000000000003000031000321",
  "0000000000003000320032100",
  "0000000000333002100010000",
  "3000023000123000000000000",
  "1230001300003000000000000",
  "0012300230003000000000000",
  "0000100022003330000000000",
  "0000000000003330002200001",
].map((pose) => Array.from(pose, (value) => opacity[Number(value)]))
const dots = Array.from({ length: 25 }, (_, index) => ({
  index,
  x: 1.5 + (index % 5) * 3,
  y: 1.5 + Math.floor(index / 5) * 3,
}))
const legacyKeyframes = dots
  .map(
    (dot) =>
      `@keyframes legacy-dot-${dot.index} { ${poses
        .map((pose, index) => `${index * 12.5}% { opacity: ${pose[dot.index]}; }`)
        .join(" ")} 100% { opacity: ${poses[0][dot.index]}; } }`,
  )
  .join("\n")

function LegacyIndicator(props: { size: number }) {
  return (
    <svg width={props.size} height={props.size} viewBox="0 0 16 16" aria-hidden="true" data-legacy-indicator>
      {dots.map((dot) => (
        <rect
          x={dot.x}
          y={dot.y}
          width={2}
          height={2}
          fill="currentColor"
          style={{ animation: `legacy-dot-${dot.index} 1200ms ease-out infinite both` }}
        />
      ))}
    </svg>
  )
}

function Controls(props: { mode: () => "legacy" | "mask"; setMode: (mode: "legacy" | "mask") => void }) {
  const [fps, setFps] = createSignal(0)
  const [slow, setSlow] = createSignal(0)
  let frame = 0
  let previous = performance.now()
  let started = previous
  let frames = 0
  let slowFrames = 0
  const update = (now: number) => {
    frames++
    if (now - previous > 1000 / 50) slowFrames++
    previous = now
    if (now - started >= 500) {
      setFps(Math.round((frames * 1000) / (now - started)))
      setSlow(slowFrames)
      frames = 0
      slowFrames = 0
      started = now
    }
    frame = requestAnimationFrame(update)
  }
  frame = requestAnimationFrame(update)
  onCleanup(() => cancelAnimationFrame(frame))

  const select = (mode: "legacy" | "mask") => {
    props.setMode(mode)
    const url = new URL(location.href)
    url.searchParams.set("mode", mode)
    history.replaceState(null, "", url)
  }
  const selectCount = (count?: number) => {
    const url = new URL(location.href)
    if (count) url.searchParams.set("count", String(count))
    if (!count) url.searchParams.delete("count")
    location.href = url.href
  }

  return (
    <aside id="controls">
      <div id="switcher">
        <button data-active={props.mode() === "legacy"} onClick={() => select("legacy")}>
          Old
        </button>
        <button data-active={props.mode() === "mask"} onClick={() => select("mask")}>
          Baked Mask
        </button>
      </div>
      <div id="count-switcher">
        <button data-active={requestedCount === 200} onClick={() => selectCount(200)}>
          200
        </button>
        <button data-active={requestedCount === 800} onClick={() => selectCount(800)}>
          800
        </button>
        <button data-active={requestedCount === undefined} onClick={() => selectCount()}>
          Fill
        </button>
      </div>
      <strong>{fps()} page FPS</strong>
      <span>{slow()} slow frames / 0.5s</span>
      <span>{count().toLocaleString()} indicators</span>
      <span>{(props.mode() === "legacy" ? count() * 25 : 0).toLocaleString()} animation tracks</span>
      <Show when={props.mode() === "legacy" && count() > 800}>
        <span>Large legacy counts can block first paint.</span>
      </Show>
      <small>Use DevTools Performance monitor and Rendering frame stats for CPU/GPU data.</small>
    </aside>
  )
}

render(
  () => (
    <>
      <style>{`
        html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
        #grid {
          display: grid;
          width: 100%;
          height: 100%;
          color: #808080;
          place-items: center;
          place-content: center;
        }
        #controls {
          position: fixed;
          z-index: 1;
          inset: 16px auto auto 16px;
          display: grid;
          gap: 6px;
          width: 220px;
          padding: 12px;
          color: #e8e8e8;
          background: rgb(20 20 20 / 92%);
          border: 1px solid #444;
          border-radius: 8px;
          font: 12px/1.3 ui-monospace, monospace;
          box-shadow: 0 8px 32px rgb(0 0 0 / 30%);
        }
        #switcher { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
        #count-switcher { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
        #switcher button, #count-switcher button {
          padding: 6px;
          color: inherit;
          background: #2b2b2b;
          border: 1px solid #555;
          border-radius: 4px;
          cursor: pointer;
        }
        #switcher button[data-active="true"], #count-switcher button[data-active="true"] {
          color: #111;
          background: #eee;
        }
        #controls strong { font-size: 20px; }
        #controls span, #controls small { color: #aaa; }
        ${legacyKeyframes}
      `}</style>
      <Show when={!benchmark}>
        <Controls mode={mode} setMode={setMode} />
      </Show>
      <main
        id="grid"
        data-mode={mode()}
        style={{
          gap: requestedCount === undefined ? "4px" : "0",
          "grid-template-columns": `repeat(${columns()}, ${requestedCount === undefined ? "16px" : "1fr"})`,
          "grid-template-rows": `repeat(${rows()}, ${requestedCount === undefined ? "16px" : "1fr"})`,
        }}
      >
        {Array.from({ length: count() }, () =>
          mode() === "legacy" ? (
            <LegacyIndicator size={size()} />
          ) : (
            <SessionProgressIndicatorV2 width={size()} height={size()} />
          ),
        )}
      </main>
    </>
  ),
  document.getElementById("root")!,
)
