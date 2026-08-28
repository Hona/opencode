# Tab-switch optimization: 2026-08-28

This is the first-pass report. Follow-up implementation changes and measurements are recorded separately in [the second-pass report](./tab-switch-round2.md); the original observations and chart assets below are preserved.

Baseline: production revision `92b9eebab28d`. Candidate: the accompanying worktree changes. The Markdown-ready reveal contract, fixture contents, 1440 x 900 viewport, and normal data prefetch are unchanged.

## Timing Results

These are fresh comparisons of the frozen baseline and candidate builds, not a comparison against an earlier machine-load period. Each build ran 20 observations per scenario, 100 switches per build. Four five-repetition blocks per build ran serially in this order: baseline, candidate, candidate, baseline, candidate, baseline, baseline, candidate. All 200 switches passed. No retries or outliers were removed.

The original baseline remains in `tab-switch-baseline.md`. Its cold/closed and warm/closed medians were 199.8 and 59.2 ms; the fresh baseline below measured 221.15 and 62.25 ms. Timing comparisons use the fresh interleaved run. Profiling and forced GC were disabled.

### First Markdown-Ready Destination

Times are milliseconds from mousedown to the first correct sampled destination, including ready Markdown and bottom anchoring.

| Scenario             | Baseline Median | Candidate Median | Median Change | Baseline p95 | Candidate p95 |
| -------------------- | --------------: | ---------------: | ------------: | -----------: | ------------: |
| Cold, review closed  |          221.15 |           100.95 |        -54.4% |       377.30 |        132.60 |
| Cold, review open    |          234.05 |           125.40 |        -46.4% |       451.70 |        142.00 |
| Warm, review closed  |           62.25 |            53.25 |        -14.5% |        90.00 |         58.10 |
| Warm, review open    |           71.35 |            55.65 |        -22.0% |       131.80 |         64.20 |
| Warm, review resized |           80.20 |            84.10 |         +4.9% |       172.80 |         90.00 |

The resized warm case has a 3.90 ms higher first-ready median. Its p95 and subsequent confirmation improve substantially. This is a retained tradeoff, not an across-the-board first-ready win.

### Three-Sample Confirmation

This confirms correct content and geometry across three observations. It is not a compositor timestamp or a claim that all background work has ended.

| Scenario             | Baseline Median | Candidate Median | Median Change | Baseline p95 | Candidate p95 |
| -------------------- | --------------: | ---------------: | ------------: | -----------: | ------------: |
| Cold, review closed  |          368.90 |           124.45 |        -66.3% |       641.40 |        152.60 |
| Cold, review open    |          378.10 |           154.10 |        -59.2% |       768.10 |        174.70 |
| Warm, review closed  |          216.20 |            78.80 |        -63.6% |       285.40 |         79.70 |
| Warm, review open    |          222.45 |            78.70 |        -64.6% |       417.90 |         95.70 |
| Warm, review resized |          246.85 |           108.50 |        -56.0% |       447.10 |        111.80 |

Both builds recorded zero message fetches during measured switches and zero wrong/unknown destination samples. All 60 warm switches per build had zero sampled blank states. Cold switches still wait behind the readiness gate.

## CPU And Memory

Separate diagnostic runs used three observations per build for cold/closed and warm/closed switches. Chrome tracing began after setup. CPU values cover mousedown through three-sample confirmation; they are sums of renderer-main-thread `RunTask.tdur`, with boundary-crossing tasks prorated by overlap. These are approximate instrumented CPU times, not the unprofiled latency figures above.

| Diagnostic Median     |  Baseline | Candidate | Reduction |
| --------------------- | --------: | --------: | --------: |
| Cold main-thread CPU  | 436.88 ms | 181.81 ms |     58.4% |
| Warm main-thread CPU  | 288.98 ms | 101.18 ms |     65.0% |
| Cold retained JS heap | 29.97 MiB | 24.78 MiB |     17.3% |
| Warm retained JS heap | 30.36 MiB | 25.13 MiB |     17.2% |
| Cold CDP DOM nodes    |    57,156 |     3,534 |     93.8% |
| Warm CDP DOM nodes    |    57,823 |     4,931 |     91.5% |

Heap and DOM counters were collected after mounted content readiness and explicit GC, with probe DOM references released first. JS heap is the renderer main isolate only. It excludes worker heaps, the Electron main/GPU processes, and the server; these results are not total desktop RAM. DOM counters can include detached parser documents and should not be interpreted as connected visible nodes or proof of a leak.

Chrome `SchedulePostMessage` counts on the renderer main thread fell from a median 65 to 21 in cold switches and 30 to zero in warm switches. These are postMessage scheduling events, not HTTP requests.

## Trace-Led Changes

- `src/session/timeline/virtualizer.tsx`: memoize row keys and option callbacks. The old getters rebuilt keys and changed callback identity during unrelated option updates, invalidating TanStack's measurement work.
- `src/session/timeline/virtualizer.tsx`: measure the actual tail on a cold pinned mount before allowing estimates to populate the viewport. Then fill the real viewport and retain the two-check Markdown/measurement reveal gate.
- `src/session/timeline/virtualizer.tsx`: keep a two-row overscan rather than automatically constructing a 20-row buffer of offscreen Markdown, tool controls, and diffs. The original expansion produced substantial post-reveal work and layout.
- `src/session/timeline/projection.ts`: build the four row indexes in one traversal while preserving the accessor interface.
- `packages/session-ui/src/timeline/session-timeline-row.tsx`: resolve grouped content once per distinct assistant message instead of reconstructing its full content list for every reference.
- `packages/session-ui/src/components/markdown.tsx`: return an already-ready initial result synchronously rather than create a second equivalent result and repeat decoration work. Refresh LRU recency and retain live-stream behavior.
- `packages/session-ui/src/components/markdown.tsx`: do not send projection-disposal messages for completed Markdown that never created a worker projection.
- `patches/@tanstack%2Fvirtual-core@3.17.8.patch`: check measured keys before reading lazy measurement entries during snapshots. The regression test verifies two measured-entry reads rather than 100 and checks snapshot restoration and count shrinkage.

V8 sampled stacks and executing positions were mapped through each build's production source maps using `@jridgewell/trace-mapping`. The retained analysis identifies self samples, inclusive stacks, and app callsites. This is source-mapped sampling, not exact per-line instruction accounting.

An intermediate candidate moved the offscreen expansion into the wheel handler. A separate first-scroll experiment caught the resulting regression: movement took roughly 90-110 ms instead of 18 ms. That expansion was removed. The final interleaved three-pair check measured 18.30 ms baseline and 18.90 ms candidate for a 240 px scroll within an already-rendered long answer, with 21 versus 3 mounted rows. The normal regression suite now checks that this gesture does not mount unrelated history.

Remaining traced work is predominantly normal reactive component mounting, sanitization, and layout. Further architectural work may improve it, but this pass does not retain entire tab DOM trees, remove sanitization, or weaken Markdown readiness to lower the reported times. Very fast scrolling performance beyond the checked gesture was not exhaustively benchmarked; paging and anchoring correctness were exercised separately.

## Reproduce

From `packages/app`:

```sh
bun run bench:tabs
```

The command builds production, runs 20 serial repetitions per scenario without retries, prints median/p95, and preserves full records in the configured output directory. An explicit `PLAYWRIGHT_BASE_URL` uses an existing production preview instead. Use the same machine and fixture for comparisons; p95 with 20 samples is a coarse tail estimate.

Run tracing and memory diagnostics separately:

```powershell
$env:OPENCODE_PERFORMANCE_TRACE_DIR = "C:\tmp\opencode\tab-traces"
$env:OPENCODE_PERFORMANCE_MEMORY = "1"
bun run bench:tabs --repeat-each=3 --grep="review closed"
```

Unset both variables for latency comparisons. Tab traces use the interaction scope and include `session-switch:start`, `session-switch:ready`, and `session-switch:stable` markers. `bench:tabs --repeat-each=1` was also verified with automatic production build/server startup, without an externally supplied preview URL.

## Verification And Artifacts

- 200 unprofiled comparison switches passed; all raw records retained.
- 12 final interaction-scoped CPU/memory diagnostics passed without trace data loss.
- 51 component tests passed, followed by all 18 Markdown tests including the new cache-pressure regression.
- 13 app timeline tests passed, including pagination, cold/warm paint, collapse, resize, short-transcript fill, and first scroll.
- 58 shared projection tests, 8 app projection tests, 9 virtualizer tests, and 50 performance helper tests passed. The browser probe cleanup test also passed.
- App and session-ui typechecks passed. E2E typecheck remains blocked by the pre-existing `dir` typing error in `e2e/regression/new-session-workspace-pending.spec.ts:38`.
- Three adverse visual cases passed. The existing shell-disclosure case fails the same way on baseline and candidate: it selects an individual shell part, but the current UI renders a `Used 1 Shell` group.

Artifacts are under `C:\tmp\opencode\tab-switch-opt`:

- `comparison.json`: all 200 records, distributions, and changes. Source logs and reporter JSONL files are under `comparison-*`.
- `profile-comparison.json`, `*-confirmed-profile.log`, and `*-confirmed-traces`: the accepted CPU/memory results and traces. Each trace has a source-mapped `.stable.analysis.json`.
- `first-scroll-confirmed.json`: the accepted first-scroll samples.
- `baseline-dist` and `verified-dist`: the actual baseline and candidate bundles/source maps used for comparison.
- Test-result folders contain screenshots and failure diagnostics. Nothing from these artifact folders is committed.

Earlier `candidate-*` iteration logs are exploratory, not inputs to the final timing table. The older `*-final-profile` attempt is superseded: a page-lifetime trace lost data and the overall command timed out. Narrowing capture to the interaction, fixing diagnostic reference retention, and rerunning produced the accepted `*-confirmed-*` profiles.

## PR Gantt Evidence

Include the baseline-versus-candidate Gantt chart in the eventual PR. Mermaid supports Gantt diagrams, Unix-millisecond input (`dateFormat x`), and millisecond ticks. The saved definition was rendered successfully with the repository's Mermaid 11.17.2. PNG and SVG versions are also prepared; keep the image files outside git and attach them to the PR using paths that match its Markdown.

The PR-ready section and assets are in `C:\tmp\opencode\tab-switch-opt\gantt`:

- `pr-section.md`: the comparison images and validated Mermaid source, with measurement caveats.
- `baseline-vs-candidate-gantt.png`: shared-axis comparison with main-thread work, Markdown-worker work, request lifetimes, and readiness/confirmation milestones.
- `candidate-breakdown-gantt.png`: a close-up of the candidate's chronological stages.
- Matching `.svg` files, `baseline-vs-candidate.mmd`, and `mermaid-gantt.png` are retained.
- `breakdown.json` contains the selected intervals and source-mapped callbacks. The selected raw traces are `baseline-gantt-cold-0.json` and `candidate-gantt-cold-2.json`.

These are individual representative diagnostic runs, selected as the middle first-ready sample among three captures per build. CPU sampling and expensive stack capture were disabled; a small attribute observer recorded when the final answer's HTML was ready and when the transcript visibility gate opened. The charts are not scaled to the untraced medians and do not replace the timing tables above.

| Milestone                                     | Baseline Trace | Candidate Trace |
| --------------------------------------------- | -------------: | --------------: |
| Initial input/state/view-update dispatch ends |       84.09 ms |        62.16 ms |
| Final answer HTML ready in DOM                |      201.03 ms |        88.09 ms |
| Transcript visibility gate opens              |      214.84 ms |       111.75 ms |
| First correct sampled destination             |      222.30 ms |       130.90 ms |
| Three-sample confirmation                     |      382.20 ms |       158.30 ms |

In the candidate example, the first-ready window contains 89.69 ms of JS/DOM work, 23.82 ms of style/layout, 6.09 ms of paint/composite work, and 11.07 ms of other main-thread work. Those categories are made exclusive before summing. Markdown-worker tasks occupy another 16.52 ms in parallel, not an additional serial stage. The interval after reveal includes painting, native callbacks, and sampling; it is not all idle frame waiting.

The Gantt also exposes a harness limitation: Playwright request routing disables HTTP cache. The candidate trace includes a 405-byte session-info refresh and a 281,569-byte decoded brand SVG; the baseline additionally fetches the 943,958-byte decoded file-icon SVG during offscreen rendering. Request bars are observed send-to-finish lifetimes, including renderer delivery delays, not pure wire latency. No message-history fetch occurs in the measured interval. Do not extrapolate these cache-disabled sprite costs to a normally cached production application.
