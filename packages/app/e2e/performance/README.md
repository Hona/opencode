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

CPU and high-volume visual profiling are disabled by default. Set `TIMELINE_CPU_PROFILE=1` to enable both, or additionally set `TIMELINE_VISUAL_PROFILE=0` for CPU-only profiling.

Benchmarks do not assert machine-dependent performance budgets. FPS, frame percentiles, long tasks, dropped-frame equivalents, blank/source frames, remounts, overlap, gaps, and scroll drift are always emitted as structured JSON for manual comparison. Assertions only verify that the scenario and metric collection completed. Repeated repaint states are run-length grouped, but every original frame timestamp is retained alongside raw mutation batches and layout shifts.

Committed smoke and regression tests continue to own correctness coverage for pagination, tab paint, context resize, collapse state, and composer spacing.

## Chrome traces

Set `OPENCODE_PERFORMANCE_TRACE_DIR` to emit a standard Chrome DevTools trace for every benchmark page automatically:

```sh
OPENCODE_PERFORMANCE=1 \
OPENCODE_PERFORMANCE_TRACE_DIR=/tmp/opencode-performance-traces \
bun test:e2e:local -- e2e/performance/timeline/session-tab-switch-benchmark.spec.ts
```

The app package pins `devtools-tracing`, which uses Chrome DevTools' Trace Engine:

```sh
bun trace:stats /tmp/opencode-performance-traces/session-tab-switch-cold.json
bun trace:inp /tmp/opencode-performance-traces/session-tab-switch-cold.json
bun trace:selectors /tmp/opencode-performance-traces/session-tab-switch-cold.json
```

`e2e/performance/playwright.uncapped.config.ts` disables Chromium frame-rate limiting for explicit uncapped diagnostics. Native product benchmarks should use the default Playwright configuration.
