# Manual app performance suite

The app's high-volume performance diagnostics live under `packages/app/e2e/performance` and are excluded from normal local and CI Playwright discovery.

Run the suite explicitly from `packages/app`:

```sh
OPENCODE_PERFORMANCE=1 PLAYWRIGHT_WORKERS=1 bun test:e2e:local -- e2e/performance
```

PowerShell:

```powershell
$env:OPENCODE_PERFORMANCE = "1"
$env:PLAYWRIGHT_WORKERS = "1"
bun test:e2e:local -- e2e/performance
```

The suite contains:

- cold and hot session-tab timing
- cached session repaint and mutation tracing
- streaming timeline FPS, frame-gap, long-task, geometry, and remount diagnostics

CPU and high-volume visual profiling are disabled by default. Set `TIMELINE_CPU_PROFILE=1` to enable both, or additionally set `TIMELINE_VISUAL_PROFILE=0` for CPU-only profiling.

Committed smoke and regression tests continue to own correctness coverage for pagination, tab paint, context resize, collapse state, and composer spacing.

## Chrome traces

Set `OPENCODE_PERFORMANCE_TRACE_DIR` to emit standard Chrome DevTools traces where supported:

```sh
OPENCODE_PERFORMANCE=1 \
OPENCODE_PERFORMANCE_TRACE_DIR=/tmp/opencode-performance-traces \
SESSION_TAB_CPU_PROFILE=1 \
bun test:e2e:local -- e2e/performance/timeline/session-tab-switch-benchmark.spec.ts
```

The repository pins `devtools-tracing`, which uses Chrome DevTools' Trace Engine:

```sh
bun trace:stats /tmp/opencode-performance-traces/session-tab-switch-cold.json
bun trace:inp /tmp/opencode-performance-traces/session-tab-switch-cold.json
bun trace:selectors /tmp/opencode-performance-traces/session-tab-switch-cold.json
```

`e2e/performance/playwright.uncapped.config.ts` disables Chromium frame-rate limiting for explicit uncapped diagnostics. Native product benchmarks should use the default Playwright configuration.
