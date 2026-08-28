# Per-pass real-session engineering diagnostics

**Supporting detail only.** The headline result is the [full original-before/current comparison](./tab-switch-full-comparison.md), which directly compares the original approximately 500 ms experience with the complete optimized build.

This report follows the [real-data readiness fix](./tab-switch-real-data.md). Its previous-pass baseline already contains that fix. The tables below measure only the additional rendering pass, not the full user-visible gain.

The additional changes reduce measured first-content medians by roughly 22-40% for cold direct and Home opens in the affected cases. Restored-but-unvisited tabs reach DOM reveal in 55-71 ms, with first correct sampled content at 68-86 ms. **A 50 ms end-to-end result across the workload, and a 16 ms frame-work budget, are not achieved.** Reveal is not a compositor presentation timestamp and must not replace the later correctness observation when reporting these results.

## Entry Paths

All measurements use the same existing desktop-local API and real data, with an isolated production Chromium renderer at 1440 x 900. The live application and service were not restarted. The Electron debugging endpoint remained unresponsive, so these are not measurements of the user's Electron development renderer or saved desktop preferences.

The harness now distinguishes three real entry paths:

1. **Cold direct route:** neither destination metadata nor messages are prepared before navigation. This preserves the previous direct-route scenario.
2. **Home row:** click the actual production Home row. Its normal handler has session metadata from the listing, but the destination message page has not been requested.
3. **Restored unvisited tab:** use the actual titlebar tab and the app's normal first-page prefetch. Exactly one 20-message page is prefetched, but no destination transcript has rendered. This is not the old full-history fixture.

Source-session startup requests finish before the measured action. SSE stays connected. Destination message-fetch counts and absence of its transcript are checked before every action. This separates normal navigation from application-startup overlap; it does not represent every possible load level or first application launch. One exploratory run did observe an approximately 480 ms API response during startup overlap. It is retained, not evidence that the server can never be slow.

## Results

All 120 final switches passed: four cases, three entry paths, two builds, five observations per cell. Runs were serial, in build order baseline / candidate / candidate / baseline / candidate / baseline / baseline / candidate / baseline / candidate for each entry path. No retries, CPU profiling, forced GC, or discarded outliers. With five observations, report medians and ranges rather than treating the maximum as a reliable p95.

Times below are milliseconds. The case labels match the earlier real-data report. `Control` is a real session whose first page already begins with a user boundary.

### Cold Direct Route

| Case    | Previous-pass ready median | Next-pass ready median | Next-pass DOM reveal median | Next-pass ready range |
| ------- | -------------------------: | ---------------------: | --------------------------: | --------------------: |
| Control |                      130.9 |                  102.6 |                        91.1 |            99.9-110.6 |
| A       |                      113.9 |                   89.1 |                        79.1 |             87.2-97.7 |
| B       |                      138.6 |                   99.2 |                        84.6 |            94.7-110.6 |
| C       |                      146.2 |                  107.5 |                       103.8 |           101.8-110.5 |

### Home Row

| Case    | Previous-pass ready median | Next-pass ready median | Next-pass DOM reveal median | Next-pass ready range |
| ------- | -------------------------: | ---------------------: | --------------------------: | --------------------: |
| Control |                      131.3 |                   95.8 |                        82.5 |             90.2-97.1 |
| A       |                      134.9 |                   81.7 |                        67.9 |             79.0-83.4 |
| B       |                      154.9 |                   93.3 |                        75.5 |            86.2-100.9 |
| C       |                      162.7 |                   98.8 |                        81.9 |            96.1-102.5 |

### Restored Unvisited Tab

| Case    | Previous-pass ready median | Next-pass ready median | Next-pass DOM reveal median | Next-pass ready range |
| ------- | -------------------------: | ---------------------: | --------------------------: | --------------------: |
| Control |                      111.1 |                   82.8 |                        63.9 |             71.0-90.7 |
| A       |                       98.9 |                   67.7 |                        54.8 |             62.8-81.6 |
| B       |                       90.6 |                   77.8 |                        64.4 |             65.4-91.0 |
| C       |                      103.3 |                   85.7 |                        71.0 |             74.4-99.8 |

The sampler continues through the later parent-enrichment requests. All post-readiness observations kept the latest group, required ready content, no source content, and bottom error at most 1 px. Enrichment remains background work; it is not removed from the workload. No API fixtures substitute for real data in these tables.

## Source-Backed Changes

- `src/session/session-resolution.ts`: start `message.sync(id)` with metadata resolution, before constructing the selected view. The existing server/session-scoped sync cache deduplicates the timeline's subsequent read. Metadata resolution does not await messages or consume their errors.
- `src/home/sessions/controller.tsx`: start the foreground message read at Home selection. Commit tab navigation, session-cache insertion, and project changes within one transition, with navigation scheduled before invalidating the outgoing Home list. Background opening still does not select the new tab.
- `packages/ui/src/context/marked-base.tsx`: a bounded synchronous path uses the same Marked lexer and shared link renderer for fragments of at most 1,024 UTF-16 code units. Lexer-detected code, possible KaTeX delimiters, and larger input stay on the worker. It is not a second hand-written Markdown grammar.
- `packages/session-ui/src/components/markdown-cache.tsx` and `markdown.tsx`: completed `full` blocks may use that ready result immediately, including completed prefixes in a stream. Sanitization and cache-key/raw-text checks remain. Live projection and code streaming retain their worker paths. A synchronous parse/sanitize failure declines the fast path and retains the existing worker/escaped-text fallback.
- `packages/session-ui/src/components/basic-tool.tsx`: resolve trigger JSX once per reactive value rather than construct it repeatedly while testing its type. Structured titles and function triggers remain supported.
- `packages/session-ui/src/message/message-content.tsx`: do not construct closed standalone reasoning just to test child presence. Completed reasoning does not compute an unused streaming heading, and duration formatting is created only when timing exists. The real case-A diagnostic attributed four of eight old Markdown jobs to closed reasoning.
- `packages/ui/src/overlays/tooltip/tooltip.tsx`: do not read hover/focus state to clear an already-false block flag. The initial DOM synchronization remains untracked, avoiding a new internal-state subscription.
- `src/session/timeline/virtualizer.tsx`: coalesce hidden, pinned scroll writes after a size batch, then report the actual clamped offset after core adjustments finish. Normal scrolling and unpinned/prepend behavior keep the observer path.
- `src/session/timeline/virtualizer.tsx` and `message-timeline.tsx`: bootstrap a bounded suffix of cheap rows rather than always requiring a tail-only pass. The suffix stops at unknown/large content. Small completed Markdown, plain short user messages, small notices, gaps, and closed reasoning/tool groups are eligible. Restored disclosure keys and expansion settings are respected. Large tails still mount alone. No reveal check is removed.

The early-read/offset changes alone did not recover the full gap. Diagnostics showed actual additional row construction and Markdown work after the initial tail became ready. This is why the final changes also address duplicate construction, closed content, and small-fragment parsing rather than attributing every millisecond to scroll-event waiting.

### Main-Thread Tradeoff

Fewer worker/event boundaries can concentrate work into a longer main-thread task. Separate, instrumented case-A traces measured the following longest task spans within the input-to-ready window:

| Entry                  | Previous pass | Next pass |
| ---------------------- | ------------: | --------: |
| Cold direct route      |      29.95 ms |  42.94 ms |
| Home row               |      87.14 ms |  48.55 ms |
| Restored unvisited tab |      49.84 ms |  75.84 ms |

These are single traced examples per build/path with CPU sampling and stack instrumentation, not unprofiled frame-time distributions. They show why lower first-content latency must not be reported as achieving a 16 ms main-thread budget. Direct/restored task concentration and the small renderer-heap increase below are retained tradeoffs, not across-the-board improvements.

## Memory Tradeoff

Separate diagnostics used three observations per build/case, collected after background enrichment and explicit GC. This is the renderer main isolate, not total desktop or worker memory.

| Case | Previous-pass main-isolate heap | Next-pass main-isolate heap | Previous / next DOM counters | Previous / next dedicated workers |
| ---- | ------------------------------: | --------------------------: | ---------------------------: | --------------------------------: |
| A    |                       14.08 MiB |                   14.63 MiB |                2,069 / 1,931 |                             1 / 0 |
| B    |                       14.72 MiB |                   15.27 MiB |                2,548 / 2,405 |                             1 / 0 |
| C    |                       15.25 MiB |                   16.09 MiB |                2,511 / 2,455 |                             1 / 0 |

The main-isolate heap increases by about 0.55-0.84 MiB because it now owns a parser. These particular views need no Markdown worker after the change; large/code/math/streaming content still can start one. Worker count is not a measurement of worker heap, so this does not prove lower total process memory. An intermediate version unnecessarily imported KaTeX into the renderer and increased heap by 1.4-1.6 MiB; splitting the shared parser base removed much of that increase.

## Evidence And Verification

- 120 final real-data comparisons passed, with all observations retained in `C:\tmp\opencode\real-tabs-fast\comparison.private.json`.
- The original complex-Markdown workload passed 15 additional switches, including tables, four highlighted fences, cold/warm paths, and resized review. This is a correctness cross-check, not a replacement for the real-data table.
- 99 session-ui component tests passed, including parser sanitization, streamed completion, Mermaid, disclosure state, and trigger construction count.
- Six app component tests passed, including cold reconnects, exact-estimate rows, bounded cheap-suffix mounting, and composer behavior.
- Twenty production regression tests passed, including history hydration, first scroll, paging, collapse/resize, Home actions, and model selection.
- Twenty-three parser tests, 32 routing/timeline/virtualizer tests, 50 performance-helper tests, and both link/button probe cases passed.
- UI, session-ui, and app typechecks passed. E2E typecheck retains the existing unrelated `.dir` error at `new-session-workspace-pending.spec.ts:38`.

The final candidate bundle and source maps are in `C:\tmp\opencode\real-tabs-fast\final-dist`. The comparison baseline is `C:\tmp\opencode\real-tabs\candidate-dist`, which already contains the prior history-readiness fix. Separate final Chrome traces are under `final-traces-private`; they are not mixed into unprofiled timing distributions.

`C:\tmp\opencode\real-tabs-fast\public` contains anonymized observations, `real-session-paths.mmd`, validated Mermaid PNG/SVG, a comparison PNG/SVG, and `pr-section.md`. Charts use actual middle first-ready observations for case A in each entry path, not scaled medians or CPU-cost estimates. Table reveal and ready columns are independent medians; their difference need not equal one selected trace's interval.

Private session identifiers, titles, paths, content, and screenshots remain outside git. Only anonymized chart assets should be attached to a PR. The live app, local service, and database were not restarted or manually changed.
