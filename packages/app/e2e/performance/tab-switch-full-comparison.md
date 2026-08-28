# Session switching: full before and after

**Before means the original approximately 500 ms user experience, before the real-data readiness fix. Current means the complete optimized build.** This is the headline comparison. The smaller previous-pass comparisons are implementation diagnostics, not the measure of the full user-visible improvement.

The original frozen build and the current frozen build were rerun directly against the same real local service and data on 2026-08-29. The results below are fresh paired observations, not percentages compounded across earlier runs.

The [anonymized per-run measurements](./results/tab-switch-full-20260829.json) are checked in with this report: all 120 runs, all first-ready samples, result summaries, and selected chart milestones. They contain no session content or identifiers. The private per-frame observations and raw traces remain local.

## Full Results

For the two sessions that reproduced the half-second delay, normal restored-but-unvisited tabs improve from **528.2 to 63.8 ms** and **520.9 to 70.6 ms**. That removes approximately **450-464 ms**, an **86-88% latency reduction**. Fully cold direct opens improve from **539.2 to 87.3 ms** and **553.1 to 97.0 ms**.

All values are milliseconds from input to the first correct content observation. There are five samples per case/build/entry path. Entry paths are kept separate; they must not be mixed into one result.

### Restored Unvisited Tab

This is the actual titlebar-tab interaction. The app has normally prefetched the first 20 messages, but the destination transcript has never rendered. The original build still waited for older-parent enrichment before showing those already received messages.

| Case    | Original before median | Current median | Time removed | Latency reduction | Current range |
| ------- | ---------------------: | -------------: | -----------: | ----------------: | ------------: |
| A       |                  528.2 |           63.8 |        464.4 |             87.9% |     57.1-70.2 |
| B       |                  520.9 |           70.6 |        450.3 |             86.4% |     68.3-75.3 |
| C       |                  313.3 |           77.7 |        235.6 |             75.2% |     69.5-83.5 |
| Control |                  101.3 |           82.5 |         18.8 |             18.6% |     72.8-85.4 |

### Cold Direct Route

Neither destination metadata nor its message page is prepared before navigation. API loading remains inside the measurement.

| Case    | Original before median | Current median | Time removed | Latency reduction | Current range |
| ------- | ---------------------: | -------------: | -----------: | ----------------: | ------------: |
| A       |                  539.2 |           87.3 |        451.9 |             83.8% |     85.3-98.2 |
| B       |                  553.1 |           97.0 |        456.1 |             82.5% |    93.5-102.2 |
| C       |                  351.5 |          106.0 |        245.5 |             69.8% |    99.8-110.6 |
| Control |                  127.9 |           98.4 |         29.5 |             23.1% |    92.3-140.4 |

### Home Row

This uses the production Home-row handler. Session metadata is available from the listing, but the destination message page has not been fetched.

| Case    | Original before median | Current median | Time removed | Latency reduction | Current range |
| ------- | ---------------------: | -------------: | -----------: | ----------------: | ------------: |
| A       |                  573.7 |           88.4 |        485.3 |             84.6% |    85.5-103.9 |
| B       |                  567.9 |           94.6 |        473.3 |             83.3% |    85.9-109.8 |
| C       |                  390.5 |          100.5 |        290.0 |             74.3% |    97.1-113.5 |
| Control |                  127.8 |           97.3 |         30.5 |             23.9% |    88.8-112.3 |

A and B required two older pages during enrichment; C required one. The control already had a leading user boundary and did not incur the old enrichment wait. These are the same anonymized cases as the earlier real-data investigation, not replacement fixtures or shorter payloads.

## Baseline And Method

- **Original before:** `C:\tmp\opencode\tab-switch-round2\verified-final-dist`. This is the frozen build used to reproduce the original half-second delay, not an intermediate post-readiness-fix build and not a claim about an untouched repository revision.
- **Current:** `C:\tmp\opencode\real-tabs-fast\final-dist`. This contains the readiness fix and all subsequent rendering/navigation changes.
- The frozen source maps were checked: the original contains the `!leadingTurnNeedsParent(messages)` display gate; the current build permits a nonempty loaded history to render.
- All 120 comparisons passed: four cases, three entry paths, two builds, five samples per cell. Each path ran serially in order original / current / current / original / current / original / original / current / original / current.
- No retries, removed outliers, API fixtures, CPU profiling, or forced GC were used. Source-session startup requests completed before the measured action. The real history window was checked against the previously inspected message boundaries before each comparison.
- Fresh browser contexts isolate client state. The viewport is 1440 x 900 with default renderer preferences and blocked service workers. The read-only loopback proxy uses the same existing desktop-local service and preserves response compression.
- Sampling continues through background history enrichment. Every post-readiness observation retained the latest group, required ready content, no source content, and bottom error at most 1 px.

These are small diagnostic samples, so the tables report medians and ranges, not a claimed p95 or universal worst case. They use an isolated production Chromium renderer, not the user's live Electron development renderer or saved desktop preferences. The app, service, and database were not restarted or manually changed.

## What Removed The Delay

The largest improvement is the client readiness fix in `packages/app/src/session/timeline/model.ts`: loaded messages are displayed without waiting for older-parent enrichment. The original path waited 200 ms before each older-page read and withheld the whole transcript until that preparation finished. Later improvements overlap reads and view setup, avoid duplicate/closed-content construction, and reduce small-Markdown and measurement overhead.

The same content-readiness contract is retained. The first correct observation includes the destination content, ready required Markdown, correct latest group, and bottom anchoring. DOM reveal is an earlier, separately recorded milestone, not a substitute for this endpoint. The code still has the main-thread and memory tradeoffs documented in the [per-pass engineering report](./tab-switch-real-fast.md#main-thread-tradeoff). The full latency improvement does not mean the 50 ms end-to-end or 16 ms frame-work targets have been reached everywhere.

## Full Gantt Evidence

Use the full-original comparison in PR headlines and before/after charts:

- `C:\tmp\opencode\real-tabs-full\public\pr-section.md`: full comparison and validated Mermaid.
- `real-session-paths.png` and `.svg`: original half-second delay versus current, on the same axis.
- `real-session-paths.mmd` and `mermaid-gantt.png` / `.svg`: the rendered Mermaid definition.
- `observations.json`: anonymized per-run measurements, summaries, and the selected case-A samples; also checked in as [tab-switch-full-20260829.json](./results/tab-switch-full-20260829.json).
- `builds.json`: frozen route-bundle SHA-256 hashes and verification of the original/current history-readiness guards.

Charts use actual middle first-ready observations from the five samples for each build/path. They are not scaled to an aggregate. The long original interval after the first page is received includes client processing and the two 200 ms enrichment waits; it is not pure API latency. The current chart keeps each entry path's data-preparation conditions explicit.

Raw observations and screenshots remain private under `C:\tmp\opencode\real-tabs-full`. No session identifiers, titles, directories, or content are included in the public assets. Do not publish the private files. Earlier reports and raw data are preserved as historical diagnostics; they do not replace this full baseline. Only the two owned diagnostic proxies were stopped after measurement; the live app and local service were left running.
