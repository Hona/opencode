# Tab-switch baseline: 2026-08-28

Production app revision: `92b9eebab28d`. No production rendering code was changed for this baseline. The existing local `bun.lock` changes were left untouched.

## Results

All 100 measured switches passed: 20 observations per row, collected serially in 5.7 minutes. Times are in milliseconds.

| Switch | Review                           | First ready median | First ready p95 | Three-sample confirmation median | Three-sample confirmation p95 |
| ------ | -------------------------------- | -----------------: | --------------: | -------------------------------: | ----------------------------: |
| Cold   | Closed                           |              199.8 |           330.8 |                            318.2 |                         532.7 |
| Cold   | Open                             |              217.3 |           261.1 |                            342.5 |                         495.7 |
| Warm   | Closed                           |               59.2 |           123.7 |                            203.3 |                         334.3 |
| Warm   | Open                             |               64.3 |           105.4 |                            205.6 |                         361.0 |
| Warm   | Open after warming at full width |               70.7 |           115.0 |                            234.4 |                         333.1 |

First-ready ranges were 167.0-333.8 ms (cold/closed), 185.9-407.7 ms (cold/open), 47.5-127.8 ms (warm/closed), 50.6-124.9 ms (warm/open), and 52.3-119.1 ms (warm/resized). Median absolute deviations were 19.2, 19.2, 11.3, 11.6, and 16.2 ms respectively. All observations, including slower later repetitions, are retained.

No measured switch fetched messages or showed wrong/unknown destination content in the samples. All 60 warm switches had zero sampled blank states. All 40 cold switches had sampled hidden/blank transcript states before the ready destination appeared; this records the readiness gate, not raw-to-formatted Markdown flicker. Sampling does not establish compositor-level flicker absence.

## Workload

- Both tabs contain 200 user/assistant exchanges, or 400 loaded messages each.
- Every assistant answer contains headings, emphasis, links, a blockquote, task and nested lists, an eight-row table, and four highlighted code fences: TSX, JSON, SQL, and Bash.
- Each session contains 611,530 bytes of Markdown and 3,915,458 bytes of serialized message-fixture data, including reasoning, tool results, and diffs.
- The mock API returns the full history in one response. Production virtualization remains enabled; 400 loaded messages does not mean 400 messages mounted in the DOM.
- Review-open scenarios use 72 changed files. The resized scenario warms the destination at full width, returns to the source, opens review, and then switches back.

## Measurement

The clock starts at the tab's `mousedown` event. The primary endpoint, `firstCorrectObservedMs`, is the first sampled DOM state with the destination's final answer visible, its Markdown ready, no source content visible, and bottom-anchor error within one pixel. `stableObservedMs` confirms the same conditions across three consecutive observations. These are DOM observation times, not compositor presentation timestamps or proof that all background rendering has stopped.

Cold means the destination transcript has never rendered in the fresh browser context. Warm means its mounted Markdown and final answer have completed rendering before switching away and back. Both cases use normal restored-tab data prefetch, which completes before measurement. No message fetch should occur inside the measured switch. App launch, initial Markdown-engine startup, backend latency, Mermaid completion, and image loading are outside this baseline's scope.

Setup waits for mounted Markdown readiness and the actual review-panel width transition. Service workers are blocked so the production web build's approximately 32 MB asset precache cannot compete with the renderer. Playwright video and tracing, Chrome profiling, and CPU throttling are off. Screenshots are taken after measurement in the first repetition only.

## Environment

- Windows 11 Pro, build `10.0.26200`.
- Intel Core i7-12800H: 14 cores, 20 logical processors; 32 GB RAM.
- Windows High performance power plan.
- Headless Chromium `147.0.7727.15`, Playwright `1.59.1`, Bun `1.4.0`.
- Production Vite build, served from a dedicated preview at `http://127.0.0.1:4617`.
- Viewport: 1440 x 900, default Chromium frame-rate limiting, one Playwright worker.
- Fresh browser context per observation. Twenty repetitions per scenario, no retries or discarded outliers.

This measures the shared app renderer in Chromium, not a packaged Electron application or a remote backend. Compare future changes on the same machine with the same fixture and controls. With 20 observations, p95 is the second-largest value using the nearest-rank definition; it is a coarse tail estimate.

## Reproduce

Run from `packages/app`. The manual performance configuration builds and serves the production bundle unless `PLAYWRIGHT_BASE_URL` points to an existing production preview.

```powershell
$env:PLAYWRIGHT_PORT = "4617"
$env:PLAYWRIGHT_BUILD = "1"
bunx playwright test --config e2e/performance/playwright.config.ts timeline/session-tab-switch-benchmark.spec.ts --repeat-each=20 --workers=1 --retries=0
```

Leave `OPENCODE_PERFORMANCE_TRACE_DIR` and `OPENCODE_PERFORMANCE_SELECTOR_TRACE` unset for timing comparisons. Use a separate run for detailed profiling.

## Recent Changes

- `27a53969d6a8` (#44333): gate initial transcript visibility on measured rows and Markdown readiness.
- `03fb5c6c675d` (#45115): correct stale virtual-row measurements on remount and reflow.
- `2ca55b479d5f` (#45428): start with overscan 2, expand to 20 after reveal, batch measurements, remove the cold reveal fade, and reduce completed-Markdown DOM work. Also changed the benchmark to start at mousedown and require a ready answer.

The old tab fixture had a 12-exchange source and a 72-exchange destination, but normal pagination initially loaded only 20 messages. Its measured final answer was 610 characters of plain prose. Those timings are not comparable to this full-history, complex-Markdown workload.

## Artifacts

Raw logs, per-observation JSON, the summary, Playwright results, and screenshots are retained outside the repository under `C:\tmp\opencode\tab-switch-baseline-20260828`.

The accepted run ID is `tab-switch-long-final-92b9eebab2`. `raw.json` preserves every benchmark record and its original DOM observations; `summary.json` includes per-scenario distributions and every timing value. `playwright-final.json` records test outcomes and screenshot attachments; PNG files are under `results-final`. `summarize.ts` validates the 100 passing records and computes the summary.

Only `baseline-final.log` contributes to the reported baseline. `smoke.log`, `validation.log`, and the interrupted `baseline.log` are setup diagnostics. The interrupted run was stopped to add the explicit width-transition wait and block service-worker precaching, not to remove slow observations.

## Verification

- Production build: passed.
- Final benchmark: 100 passed, no retries.
- Performance helper unit tests: 48 passed.
- App `bun typecheck`: passed.
- E2E type checking remains blocked by an unrelated existing `HTMLElement | SVGElement` / `dir` error in `e2e/regression/new-session-workspace-pending.spec.ts:38`.
