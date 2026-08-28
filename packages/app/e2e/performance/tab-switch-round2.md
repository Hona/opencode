# Tab-switch optimization, second pass

For actual unvisited-session API loading, see the later [real local-data investigation](./tab-switch-real-data.md). The prefetched fixture below does not include that critical path.

This extends the [first-pass comparison](./tab-switch-optimization.md). The original revision is `92b9eebab28d`. "Pass 1" means its previously measured optimized production bundle, preserved in `C:\tmp\opencode\tab-switch-opt\verified-dist`. "Pass 2" means the follow-up worktree changes described here. No commit or PR is implied by these labels.

The second pass reduces cold first-ready medians by 8-14% against a fresh Pass 1 comparison and cold main-thread CPU by 18.4% in separate diagnostics. **It does not reach a 16 ms cold-load or frame-work budget.** Some p95 results regress, especially resized warm navigation; those observations remain in the results.

## Measured Results

All 400 unprofiled switches passed: 20 observations per scenario, build, and transport. Each transport ran four five-repetition blocks per build, serially, in this order: Pass 1, Pass 2, Pass 2, Pass 1, Pass 2, Pass 1, Pass 1, Pass 2. No retries or outlier removal. Profiling, video, Playwright tracing, and forced GC were off.

Earlier exploratory runs encountered substantial unrelated system load. The comparisons below use fresh paired builds, not the earlier machine-load period. In particular, Pass 1 now measures 82.05 ms cold/closed with routing, versus 100.95 ms in its earlier report. Do not attribute that difference to this patch.

Times are milliseconds. "Ready" means the first correct observation; "confirmed" means the third consecutive correct observation. p95 uses nearest rank and is a coarse tail estimate with 20 samples.

### Cache-Enabled HTTP

| Scenario             | Pass 1 ready median / p95 | Pass 2 ready median / p95 | Ready median change | Pass 1 confirmed median / p95 | Pass 2 confirmed median / p95 |
| -------------------- | ------------------------: | ------------------------: | ------------------: | ----------------------------: | ----------------------------: |
| Cold, review closed  |             70.40 / 93.10 |             64.65 / 83.00 |               -8.2% |                94.60 / 123.10 |                93.25 / 109.20 |
| Cold, review open    |            87.30 / 130.80 |            77.25 / 117.90 |              -11.5% |               112.20 / 155.00 |               101.85 / 142.50 |
| Warm, review closed  |             43.40 / 51.50 |             39.35 / 60.00 |               -9.3% |                 62.85 / 79.00 |                 63.25 / 78.20 |
| Warm, review open    |             44.85 / 55.50 |             40.90 / 56.70 |               -8.8% |                 63.05 / 80.00 |                 62.40 / 75.10 |
| Warm, review resized |             47.15 / 52.20 |            48.10 / 107.30 |               +2.0% |                 77.65 / 79.80 |                78.90 / 128.70 |

### Cache-Disabled Routing

| Scenario             | Pass 1 ready median / p95 | Pass 2 ready median / p95 | Ready median change | Pass 1 confirmed median / p95 | Pass 2 confirmed median / p95 |
| -------------------- | ------------------------: | ------------------------: | ------------------: | ----------------------------: | ----------------------------: |
| Cold, review closed  |             82.05 / 89.00 |             74.05 / 90.30 |               -9.8% |               109.75 / 110.40 |                93.95 / 121.30 |
| Cold, review open    |            92.85 / 120.20 |            80.25 / 123.00 |              -13.6% |               112.35 / 144.50 |               110.65 / 141.90 |
| Warm, review closed  |             41.90 / 47.00 |             39.80 / 48.20 |               -5.0% |                 62.95 / 78.70 |                 63.05 / 77.40 |
| Warm, review open    |             46.40 / 50.20 |             45.35 / 53.90 |               -2.3% |                 77.35 / 79.40 |                 63.95 / 79.00 |
| Warm, review resized |             49.25 / 62.40 |             49.45 / 78.50 |               +0.4% |                 78.20 / 79.60 |                74.55 / 110.70 |

Across both series there were zero message-history requests during switches, zero wrong/unknown destination observations, and zero sampled warm blank states. This does not mean zero HTTP requests: session-info refreshes still occur.

### Tail And Scroll Checks

The worst observed Pass 2 HTTP cold cases were 95.50 ms with review closed and 125.60 ms with review open. The resized-warm maximum was 121.70 ms. These sample maxima are not guarantees about worst-case application behavior.

The four highest HTTP resized-warm candidate samples occurred in the final candidate block. A separate, unprofiled, ten-observation-per-build check in Pass 2 / Pass 1 / Pass 1 / Pass 2 blocks measured ready median/p95 of 49.25/83.40 ms for Pass 1 and 43.90/47.40 ms for Pass 2. It did not reproduce the slowdown, but cannot establish its cause. The 400-run results above are unchanged; the follow-up is not a replacement distribution.

A separate three-pair first-scroll check measured 18.10 ms for Pass 1 and 18.40 ms for Pass 2, median time to observe a 240 px upward movement inside the already-rendered long answer. Both kept three mounted rows. This does not measure sustained fast-scroll frame pacing.

## CPU And Memory

Separate HTTP-fixture diagnostics captured three cold/closed and three warm/closed switches per build. CPU is approximate renderer-main-thread CPU through three-observation confirmation, summed from Chrome `RunTask.tdur` with boundary tasks prorated. These instrumented runs are not inputs to the latency tables.

| Diagnostic median              |    Pass 1 |    Pass 2 | Change |
| ------------------------------ | --------: | --------: | -----: |
| Cold main-thread CPU           | 106.57 ms |  86.96 ms | -18.4% |
| Warm main-thread CPU           |  58.34 ms |  51.87 ms | -11.1% |
| Cold retained renderer JS heap | 24.67 MiB | 24.07 MiB |  -2.5% |
| Warm retained renderer JS heap | 25.05 MiB | 24.37 MiB |  -2.7% |
| Cold CDP DOM nodes             |     2,838 |     2,561 |  -9.8% |
| Warm CDP DOM nodes             |     2,843 |     2,566 |  -9.7% |

Cold main-thread postMessage scheduling events fell from a median 21 to 3; warm remained zero. These are browser scheduling events, not message-history requests or exact Markdown-parse counts. A separate diagnostic recorded the actual worker messages for the corrected cold path and showed one required answer parse.

Heap and DOM counts are collected after mounted-content readiness and explicit GC, after releasing probe DOM references. Heap excludes workers, Electron main/GPU processes, and the server. DOM counters can include detached parser documents. These are not total desktop memory measurements.

## Workload And Endpoints

The `long-complex-markdown-v1` workload is unchanged: 200 exchanges and 400 loaded messages per session, 611,530 Markdown bytes per session, an eight-row table and four highlighted fences in every answer, and 72 changed files when review is open. All history is loaded, but only the viewport and overscan are rendered. The viewport is 1440 x 900, with unthrottled headless Chromium 147.0.7727.15 on the Windows machine described in the original report.

Cold still means the first destination transcript render, after ordinary restored-tab message prefetch. It does not include app startup, source-session Markdown engine initialization, or a cold backend request. The earlier Markdown job now starts during destination timeline construction, after mousedown, not during fixture preparation. Warm still means rendering the destination, leaving it, and returning to it.

- `firstCorrectObservedMs`: first sampled visible destination answer with converted Markdown, the correct latest group, no visible source content, and bottom error at most 1 px.
- `stableObservedMs`: third consecutive correct observation. Its observation schedule spans frames; it is not the earliest instant at which layout became stable.
- Traced HTML-ready and reveal marks: DOM milestones, not compositor presentation timestamps.
- A sub-16-ms cold render and a sub-16-ms main-thread frame budget are separate targets. A shorter reveal wait proves neither by itself. No machine-dependent timing assertion or weaker readiness criterion was added.

## Implementation

- `packages/app/src/session/requests/background.ts`: one history derivation collects background tool records and completion notices. Live child/session and shell joins are separate, so a live status change does not scan the whole history again. Completion IDs, category order, deduplication, and blocking exclusions are preserved.
- `packages/session-ui/src/timeline/projection.ts`: `resolveContent` scans to the requested part instead of allocating wrappers for every part first. Text/reasoning ordinals still count blank and hidden parts; duplicate IDs retain first-match behavior.
- `packages/app/src/composer/editor/editor.tsx`: the reactive effect owns initial editor rendering. The ref no longer builds the same draft DOM again.
- `packages/app/src/providers/models/selection.tsx`: resolve the selected model once in a reactive memo rather than repeat validation and catalog search for each control.
- `packages/session-ui/src/components/basic-tool.tsx` and `src/tools/tool-renderer.tsx`: a known-content flag prevents a collapsed context group's presence check from constructing its hidden children. Expansion and collapse keep the existing disclosure lifecycle.
- `packages/app/src/session/timeline/message-timeline.tsx` and `packages/session-ui/src/components/markdown-cache.tsx`: start the required completed tail answer's worker job before constructing the rest of the selected view. Matching in-flight work is shared with the row renderer. Parsing, highlighting, sanitization, and HTML application remain required.
- `packages/app/src/session/timeline/virtualizer.tsx`: replace repeated two-frame cold polling with a coalesced check triggered by content readiness, size delivery, scroll-offset delivery, and viewport reconnection. While hidden, measure mounted rows together using current boxes, commit sizes, publish total height, establish the correct range and anchor, then reveal. The observers disconnect after reveal or disposal. Warm mounts do not add a new visibility gate.

The cold gate must not use TanStack's ordinary `measureElement` as proof of current layout: that path can skip synchronous measurement while scrolling. An intermediate implementation did that, expanded a stale estimated range, and started three unnecessary old-answer Markdown jobs. A diagnostic with row keys and worker messages exposed it. The corrected path reads current boxes before expanding; the diagnostic then showed one required Markdown job and three mounted rows. Those exploratory instrumented runs are not latency-comparison inputs.

The gate also accounts for a zero-height suspended viewport, a non-overflowing short transcript, and offset repairs that do not dispatch native scroll events. A populated history with an empty virtual range is not ready to reveal. A row whose true height equals the 60 px estimate does not require a cache-size change to count as measured.

## Transport Control

Two transports exercise the same fixture and completion checks:

1. `playwright-route`: preserves the earlier benchmark harness. Routing disables HTTP cache and can cause provider/file SVG fetches during remount.
2. `http`: `e2e/performance/tab-switch-server.ts` serves the same mock API over loopback, with immutable hashed assets and no browser request interception. This is a cache-enabled fixture, not proof of the live application's exact cache policy.

The CDP cache-override experiment did not restore caching while Playwright routing was active. It is not used as evidence of cache-enabled performance. The HTTP fixture instead removes interception entirely. No production icon artwork or SVG component was changed to optimize a harness artifact.

## Reproduce

From `packages/app`, use `bun run bench:tabs` for the original routed transport. It builds production unless an explicit production `PLAYWRIGHT_BASE_URL` is supplied. The [HTTP fixture instructions](./README.md#cache-enabled-http-fixture) describe the separate caching experiment.

Run profiling separately with `OPENCODE_PERFORMANCE_TRACE_DIR`, and memory collection with `OPENCODE_PERFORMANCE_MEMORY=1`. Do not mix those samples into unprofiled distributions. Raw benchmark records, intermediate failures, frozen bundles, and diagnostic traces are retained under `C:\tmp\opencode\tab-switch-round2`; previous-pass evidence remains in its original directory.

The original `final-*` follow-up attempt was deliberately interrupted for two reconnect fixes found in review. It is diagnostic data, not an accepted timing distribution. The accepted follow-up series uses the `confirmed-*` prefix.

## Runtime Gantt

The final charts use three interleaved captures per build and select the middle first-ready observation. The routed order was original / Pass 1 / Pass 2 / Pass 2 / Pass 1 / original / Pass 1 / original / Pass 2. The HTTP order was Pass 1 / Pass 2 / Pass 2 / Pass 1 / Pass 1 / Pass 2. CPU sampling and expensive stack capture were disabled for these charts; a small DOM observer records HTML completion and reveal. The charts show actual trace intervals, not the unprofiled medians.

### Routed Milestones

| Milestone                               |  Original |    Pass 1 |    Pass 2 |
| --------------------------------------- | --------: | --------: | --------: |
| Initial input/view-update dispatch ends |  77.63 ms |  49.09 ms |  39.20 ms |
| Answer HTML ready in DOM                | 181.33 ms |  66.19 ms |  53.69 ms |
| Measured transcript reveal              | 205.97 ms |  89.77 ms |  65.58 ms |
| First correct observation               | 212.10 ms |  98.50 ms |  80.00 ms |
| Three-observation confirmation          | 341.60 ms | 122.10 ms | 108.50 ms |

The selected Pass 2 routed trace has 52.52 ms JS/DOM, 16.91 ms style/layout, 3.49 ms paint/composite, 6.98 ms other main-thread work, and 0.10 ms gaps before readiness. Categories are made exclusive before summing. Worker tasks occupy another 7.62 ms **in parallel**. Do not add lanes together or label the post-reveal interval pure idle time.

### HTTP Milestones

| Milestone                               |    Pass 1 |   Pass 2 |
| --------------------------------------- | --------: | -------: |
| Initial input/view-update dispatch ends |  38.36 ms | 40.88 ms |
| Answer HTML ready in DOM                |  53.13 ms | 55.94 ms |
| Measured transcript reveal              |  74.95 ms | 66.05 ms |
| First correct observation               |  82.10 ms | 72.80 ms |
| Three-observation confirmation          | 109.10 ms | 93.30 ms |

This HTTP example does **not** show a faster initial dispatch or HTML completion. Its main improvement is the shorter interval from ready HTML to measured reveal. Pass 2's worker burst runs at 13.70-23.29 ms, overlapping view construction. Its longest main-thread task through confirmation is still 43.54 ms, versus 40.31 ms in the selected Pass 1 trace. Thus this pass has not demonstrated a sub-16-ms worst-case frame budget.

The HTTP traces request session metadata but no provider/file sprite during the switch. The routed traces expose the 281,569-byte decoded provider sprite, and the original build also fetches the 943,958-byte file-icon sprite. Request bars are send-to-finish lifetimes, including delivery delays, not pure wire latency.

### PR Assets

The Mermaid definitions were rendered and visually checked with Mermaid 11.17.2. Use the newer second-pass assets in the eventual PR, while preserving the first-pass report as historical evidence. Images stay outside git; attach them with paths matching the PR Markdown or replace links with hosted URLs.

- `C:\tmp\opencode\tab-switch-round2\gantt\paired-route\pr-section.md`: original / Pass 1 / Pass 2 comparison, validated Mermaid, and caveats.
- `C:\tmp\opencode\tab-switch-round2\gantt\paired-http\pr-section.md`: cache-enabled comparison and candidate breakdown.
- Each folder has `comparison.mmd`, `comparison-gantt.png`, `candidate-breakdown-gantt.png`, `mermaid-gantt.png`, matching SVGs, raw traces, and `breakdown.json` with exclusive intervals and source-mapped callbacks.
- Selected routed traces: `baseline-gantt-cold-2.json`, `previous-gantt-cold-2.json`, and `candidate-gantt-cold-2.json`.
- Selected HTTP traces: `previous-gantt-cold-0.json` and `candidate-gantt-cold-1.json`.

An earlier grouped Gantt capture encountered a command timeout between variants and changing machine load. Those files remain under `gantt\route`. Final chart evidence uses the fresh interleaved `paired-*` captures above, not a mixture of those periods.

## Verification

- 400 final paired switches, 20 separate resized-warm follow-up switches, 12 CPU/memory captures, and six first-scroll gestures passed. Raw observations are retained.
- 17 production smoke/regression tests passed, including delayed-worker first reveal at 1440/390 px, short transcripts, first scroll, paging/prepend anchoring, collapse/resize state, and A-to-B-to-A model/variant selection.
- 96 session-ui component tests, three composer component tests, and two real-virtualizer reconnect component tests passed. The reconnect tests capture the first reveal, not a later recovered frame.
- 63 shared projection tests, 23 app background/projection/virtualizer tests, seven reconnect-offset tests, and 50 performance-helper tests passed.
- App and session-ui typechecks passed. E2E typecheck still reports the pre-existing `HTMLElement | SVGElement` `.dir` error at `e2e/regression/new-session-workspace-pending.spec.ts:38`; no new E2E type errors were reported.

The accepted artifacts are under `C:\tmp\opencode\tab-switch-round2`: `comparison.json`, `final-records.json`, `confirmed-*-results\tab-switch-benchmark.jsonl`, `profile-comparison.json`, `profile-*-traces\*.stable.analysis.json`, `resized-check.json`, and `first-scroll.json`. `verified-final-dist` contains the final production bundle and source maps. `pre-gate-dist` and `verified-dist` preserve earlier iterations and are not the final candidate.

Source attribution uses each frozen build's source maps, including stored source text, through `@jridgewell/trace-mapping`. Sampling identifies callsites and inclusive stacks; it is not exact instruction accounting. The remaining work includes reactive view construction/teardown, historical projection, sanitization, and layout. No claim is made that replacing only TanStack or the Markdown parser would remove the full remaining critical path.

All owned benchmark previews on ports 4641-4645 were stopped after verification. The live application and elected OpenCode service were not restarted.
