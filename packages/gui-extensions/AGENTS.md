# GUI extensions

Built-in features of the desktop and web app, each behind the SDK in `src/sdk/`. The renderer host lives in `packages/app/src/runtime/extension/`, the main-process host in `packages/desktop/src/main/extension/`.

## Structure

- One folder per extension: `index.ts` (`Extension.define({ id, os?, i18n })`), `contract.ts`, `renderer.tsx`, optional `main.ts`, and `i18n/<locale>.ts`.
- `src/renderer.ts` and `src/main.ts` are the only files that list the built-ins, each through `Extension.compose`. Main never imports renderer code. `src/builtins.typecheck.ts` fails the typecheck when a renderer `uses` or `requires` an Ipc that no main entry provides.
- Another extension may import only your `contract.ts` (tokens and schemas, no runtime code). Declare what you use in `uses` (or `requires`); every consumer must still work when the provider is disabled (see "Failure is part of the contract"). To declare an Ipc without loading its schemas at startup, use `Ipc.ref<typeof Token>("id")` and `ctx.use(Token)` from the chunk that loads them.
- Never import `@opencode/app`, `@opencode/desktop`, or `@/` paths. Import CSS with `?inline` and contribute it through `ctx.add(Style, css)`. No module-level state: keep state inside `setup`. `bun run lint` enforces these rules.
- `bun run lint:changed` must pass before you finish: every file you add or edit has no oxlint problem at all, including the warn-level anti-slop rules (`unknown` parameters and returns, unchecked type assertions, widened types, unsafe dictionaries, missing spacing). Touching a file means leaving the whole file clean, older warnings included. Fix the code; suppress only with a `SAFETY:` comment that states a real checked invariant.

## Host boundary

- Host code must not name an extension or know its internals: no extension ids, command ids, DOM selectors, or stored key formats. When the host needs something from extensions, add a generic, documented field to the SDK (for example `PanelTab.file`, `Command.featured`, `Command.section`).
- Accepted exceptions: the built-in lists, the keybind rename map in `packages/app/src/settings/keybinds/migration.ts`, the legacy `type: "browser"` comment decode in `packages/app/src/composer/schema.ts` (drafts and message metadata written before extension notes), and the crash page's use of the updater contract.

## Lifetimes

An instance lives from `setup` until it is disabled, reloaded, removed, or its window closes. A reload can land at any `await`, so code that outlives a tick must prove it still belongs to the live instance.

- Everything registered through `ctx` (contributions, contracts, Ipcs, menu items, embeds) is withdrawn by the host when the instance goes away. Anything else you start (timers, DOM or Ipc listeners, subscriptions) needs `ctx.cleanup`. A cleanup registered after disposal runs at once.
- `setup` may be async. After every `await`, return if `ctx.signal.aborted` before touching state or contributing. Pass `ctx.signal`, or a signal derived from it, to Ipc calls and long work.
- Never keep a value from a shorter lifetime in a longer one. Read a server's `client`, `data` and `url` from its live `ServerRef` each time: a restarted or re-authenticated server gets a new controller under the same id. Keep per-session state in a session-scoped store, or in a map keyed by session that you prune.
- Main: `Lifecycle.restart(handoff, { keep: ctx.scope })` keeps the extension that owns `ctx.scope` (the caller by default) active until the handoff settles; when it rejects, return to a state the user can retry from. `ctx.cleanup` adds a finalizer to `ctx.scope`.

## Failure is part of the contract

- A `uses` contract is a `Live` accessor: `pending` while the provider loads, `inactive` while it is disabled, failed, or restarting. Every user action branches on it and still answers: show an unavailable state (as WSL's "WSL unavailable" does), never a silent `return` or an endless spinner.
- An Ipc that goes away is a suspension, not a failure: keep what the user had (for example the browser's tab inventory) and resume when it returns, without a retry timer.
- An Ipc call can reject while the event that explains it is still in flight; events and call replies travel on different channels. When main reports an outcome as an event, let the event decide, and treat a rejection as final only for errors main throws before any event (validation, missing endpoint).
- The host orders Ipc state for you: an event always wins over an older snapshot. Do not re-fetch state to fix ordering.

## Stored state

- Desktop storage loads over IPC; web storage is synchronous, so a read before load passes every web e2e test and still breaks desktop. Declare stores (`Store.global`, `Store.session`): a global store is loaded before setup, a session store's `value` is undefined until it loads, and `update` waits for the load. `Storage.store`, for keys only known at runtime, returns the same `Persisted`; derive nothing from it, such as a request, before `value` is defined.
- Moving a stored value goes through `from` (and `from.sessions` for one session's slice of an app key). Keep the old field readable until every user has migrated; never drop user data.
- Main `Storage` writes reach disk at once; do not batch them yourself.

## Panels and layout

- `Panel.focus(tab, view, { restored })`: `restored` is true only for the selection the side region mounts with (for example after a reload). Run side effects that express user intent, such as switching the file tree's tab, only when it is false.
- The host selects a fallback tab while the stored one is not listed. If you will restore a tab, keep listing its stored id, with `hidden: true` while its content is not known yet, so the fallback never runs.
- Map keys stored before extensions with `Panel.legacy`. A `transient` panel's stored keys are dropped once it stops listing them.
- `Layout.stored(session)` returns your stored tab ids. Layout reads return nothing while `session.location` is undefined (for example after a server re-authenticates); writes made meanwhile wait and apply in order once it is known.
- `Layout.sidebar.opened()` is the inner sidebar preference side panels share, readable outside a panel render (for example in a tab's fields); do not mirror `usePanel().sidebar` into a store.
- Narrow screens: a plain open switches to the panel's mobile view and closes the dock. Pass `background` when the user stays where they are (a palette pick, a composer chip) or the agent opened the tab, and `select` to append and select without replacing the preview.

## Solid

Read [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) and [Solid.js Best Practices](https://www.brenelz.com/posts/solid-js-best-practices/) before writing reactive code here. In short:

- `bun run lint` bans importing `createEffect`, `createRenderEffect` and `createComputed` outside `src/sdk/`. Run side work per provider generation or value with `createKeyed(source, fn, { otherwise })`, fetch with `createLatest`, and keep per-visit state with `createVisitState`.
- Derive, don't sync. A value computed from other state is a `createMemo` or a plain function, never an effect that calls a setter. Never mirror state into a second store, signal, or `Map` through an effect.
- An effect (`createKeyed`) synchronizes with something outside Solid: the DOM, a third-party widget, an embed, an Ipc subscription, a chunk preload. Comment what it syncs with when that isn't obvious.
- Logic caused by a user action belongs in that action's handler, not in an effect that watches the state the action changed. If several handlers share it, call one function from each.
- Reset state on an identity change by keying the subtree (`<Show keyed>`) or by storing an id and deriving the selection from it. To forget a selection when the user navigates away and back, derive a visit token (`createMemo(on(key, () => ({})))`) and keep the selection only while its token matches. Never reset state in an effect.
- No effect chains, and no effect that notifies a parent: update everything in the same handler or `batch`.
- Don't destructure props; read `props.x` so the getter stays reactive (`splitProps` when you must). Call signals when passing them as JSX props. Use `<Show>` and `<For>`, not `&&` and `.map`, in JSX.
- Use `createStore` for objects and collections, `createSignal` for single values.
- Async data goes through a resource or a guarded promise that ignores stale results, under the Suspense rules below, never an effect that fetches and then sets.

## Performance

- `renderer.tsx` loads with the app: `src/renderer.ts` imports every built-in entry eagerly, because the window renders once all of them are active. Keep it small and put heavy UI behind `lazy()`. Preload a chunk with `onIdle(() => void Chunk.preload())` from setup, so it compiles while the app idles (e.g. on Home) instead of when a session first opens. Never import a heavy chunk on the startup path.
- A `<Suspense>` boundary decides what blanks when something beneath it suspends; it does not stop the suspension. Suspend at most once, on first load, and never after first paint:
  - Read async data through `.latest`, a store with an explicit `loading` flag, or a resource that resolves once (`packages/app/src/runtime/server/runtime.tsx`, `packages/app/src/providers/connect/controller.ts`). Never read a refetching `resource()` in render: a refetch blanks the nearest boundary, and without one of yours that is the whole session route, which detaches the screen and resets the timeline scroll.
  - Wrap each `lazy()` component in its own `<Suspense>`, so a chunk that is still loading blanks only your area. Preload it with `onIdle`. If the area can be visible at startup (for example a dock restored open), start the preload in `setup` from the stored state instead, so the first render never enters Suspense and nothing pops in.
  - Give a fallback the area's size when the area has fixed geometry, so nothing shifts; leave it empty otherwise.
  - Make a state change that may suspend inside `startTransition`, so the current content stays until the next is ready.
- Return stable objects from `Panel.list` and reactive contributions, so the host never remounts a trigger or a panel.
- Never add work to timeline rows. The session header slot is the only timeline surface.

## Localization

- Each extension owns its copy in `i18n/en.ts` with short keys. `ctx.t` falls back to the app's keys only for shared vocabulary such as `common.*`; feature copy belongs to the extension.
- When moving copy, keep the English byte-for-byte and carry every locale's translation. The localization rules in `packages/app/AGENTS.md` apply.

## Tests

- Follow the Tests section of `packages/app/AGENTS.md`.
- Unit-test pure logic that carries a contract: path and security checks, storage migration, protocol parsing, archive validation.
- UI behavior is proven by the app e2e keeper suites. Do not add unit tests that repeat them.
- Test a main-process entry through its `Ipc` contract with real inputs, not through Electron mocks.
- For lifetime and ordering contracts, drive the race the user hits: a reload during async setup, a rejection that beats its event, a store that loads late (the e2e fixtures can hold desktop storage reads), an Ipc that goes away and returns.
