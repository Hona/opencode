# Desktop test coverage

Automated coverage across `app`, `desktop`, `session-ui`, and `ui` focuses on:

- Performance benchmarks, timeline stability, and the tools that measure them.
- User journeys through model selection, sign-in, session creation, first-prompt
  submission, and recovery without losing the draft.
- Provider configuration, onboarding preferences, and usage-limit upsell preferences.
- Desktop draft/attachment storage and migrations, plus service-worker update recovery.

The existing upsell tests cover saved preferences. They do not exercise the complete
free-limit → checkout → paid-response journey.

## Run coverage

Run these commands from `packages/app`:

```sh
bun run test
bun run test:e2e:built
bun run test:service-worker
bun run test:bench
bun run test:stability
bun run test:bench:devex
```

Run `bun run test` from `packages/desktop` for storage and browser diagnostics.
Its native suite exercises real Electron trace, CPU, and heap capture over HTTP;
it requires a display and is skipped in CI.

See [app benchmarks](e2e/performance/README.md),
[highlighting benchmarks](../session-ui/performance/highlighting/README.md), and
[Markdown lifetime benchmarks](../session-ui/performance/markdown-lifetime/README.md)
for focused performance runs. Keep benchmarks serial and use production builds.

Use `bun run dev:storybook` from the repository root to inspect component stories.
Use `bun run check` from the root for lint and type checks.

## Add coverage

Prefer a small user-journey test that proves the final outcome. Add a focused unit
test when it uniquely protects data or a meaningful boundary. Use stories for
appearance checks. Avoid duplicating component assertions across layers or freezing
CSS values, source text, and internal object shapes in tests.
