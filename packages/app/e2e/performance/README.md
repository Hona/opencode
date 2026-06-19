# Manual app performance suite

The app's high-volume performance diagnostics live under `packages/app/e2e/performance` and are excluded from normal local and CI Playwright discovery.

Run the suite explicitly from `packages/app`:

```sh
bun run test:bench
```

PowerShell:

```powershell
$env:PLAYWRIGHT_WORKERS = "1"
bun run test:bench
```

The suite contains:

- cold and hot session-tab timing
- cached session repaint and mutation tracing
- streaming timeline FPS, frame-gap, long-task, geometry, and remount diagnostics

All benchmarks import the shared `benchmark` fixture. Pages created through Playwright's `page` fixture automatically capture main-frame navigation history and emit a Chrome trace when `OPENCODE_PERFORMANCE_TRACE_DIR` is set. Benchmarks that need isolated browser contexts use `withBenchmarkPage`, which owns the context and the same diagnostics lifecycle.

New benchmarks should look like normal Playwright tests:

```ts
import { benchmark, expect } from "../benchmark"

benchmark("measures one interaction", async ({ page, report }) => {
  // Only scenario-specific setup and interaction belong here.
  report({ durationMs: 42 })
})
```

The fixture requires every benchmark to call `report()`, automatically names and closes traces, captures navigation history, attaches that history when a test fails, and emits metrics as a consistent `BENCHMARK` JSON line.

```text
BENCHMARK {"name":"...","context":{"project":"chromium","platform":"darwin"},"metrics":{...}}
```

Every observed page also emits `BENCHMARK_PAGE` automatically with navigation history and the optional trace path. Frame, long-task, layout-shift, interaction, script, style, layout, paint, heap, and call-stack analysis stays in scenario probes or the linked Chrome trace. The generic harness does not duplicate Chrome's profiler with custom browser-wide counters or observers.

This follows the stack's own guidance: [Electron recommends repeated Chrome DevTools and Chrome Tracing measurement](https://www.electronjs.org/docs/latest/tutorial/performance), [Chrome DevTools recommends Performance recordings for runtime work](https://developer.chrome.com/docs/devtools/performance), and [Playwright uses traces for test debugging rather than renderer profiling](https://playwright.dev/docs/trace-viewer).

These Playwright benchmarks profile the shared app renderer in Chromium. A future packaged Electron benchmark that needs main-process and multi-process attribution should use Electron's official [`contentTracing`](https://www.electronjs.org/docs/latest/api/content-tracing/) API rather than extending this renderer harness with bespoke process instrumentation.

CPU and high-volume visual profiling are disabled by default. Set `TIMELINE_CPU_PROFILE=1` to enable both, or additionally set `TIMELINE_VISUAL_PROFILE=0` for CPU-only profiling.

The streaming scenario's 30x CPU throttle is a deterministic stress profile, not a simulated end-user device.

Benchmarks do not assert machine-dependent performance budgets. FPS, frame percentiles, long tasks, dropped-frame equivalents, blank/source frames, remounts, overlap, gaps, and scroll drift are always emitted as structured JSON for manual comparison. Assertions only verify that the scenario and metric collection completed. Repeated repaint states are run-length grouped, but every original frame timestamp is retained alongside raw mutation batches and layout shifts.

Committed smoke and regression tests continue to own correctness coverage for pagination, tab paint, context resize, collapse state, and composer spacing.

## Chrome traces

Set `OPENCODE_PERFORMANCE_TRACE_DIR` to emit a standard Chrome DevTools trace for every benchmark page automatically:

```sh
OPENCODE_PERFORMANCE=1 \
OPENCODE_PERFORMANCE_TRACE_DIR=/tmp/opencode-performance-traces \
bun test:e2e:local -- e2e/performance/timeline/session-tab-switch-benchmark.spec.ts
```

The emitted JSON is a standard Chrome trace and can be loaded directly into the Chrome DevTools Performance panel. `devtools-tracing` can optionally inspect it from the command line without adding package scripts or dependencies:

Trace capture mirrors [Puppeteer's official tracing defaults and lifecycle](https://pptr.dev/api/puppeteer.tracing), using Chrome's `ReturnAsStream` transfer mode and failing when Chromium reports trace data loss.

```sh
bunx devtools-tracing stats /tmp/opencode-performance-traces/session-tab-switch-cold.json
bunx devtools-tracing inp /tmp/opencode-performance-traces/session-tab-switch-cold.json
bunx devtools-tracing selector-stats /tmp/opencode-performance-traces/session-tab-switch-cold.json
```

`e2e/performance/playwright.uncapped.config.ts` disables Chromium frame-rate limiting for explicit uncapped diagnostics. Native product benchmarks should use the default Playwright configuration.
