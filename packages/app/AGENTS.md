## Debugging

- NEVER try to restart the app, or the server process, EVER.

## Local Dev

- `opencode dev web` proxies `https://app.opencode.ai`, so local UI/CSS changes will not show there.
- For local UI changes, run the backend and app dev servers separately.
- Backend (from `packages/opencode`): `bun run --conditions=browser ./src/index.ts serve --port 4096`
- App (from `packages/app`): `bun dev -- --port 4444`
- Open `http://localhost:4444` to verify UI changes (it targets the backend at `http://localhost:4096`).

## SolidJS

- Always prefer `createStore` over multiple `createSignal` calls
- Use effects only to synchronize with external systems; prefer derived state and explicit actions for app state.

## Architecture

- Strong ownership should make consumers simple and reduce branching.
- Prefer strict contexts with explicit domain values; do not add implicit or theoretical fallbacks.
- Keep route, server, directory, session, draft, and tab identities explicit.
- Prefer explicit transactions over synchronization between independent state stores.
- Avoid duplicate or near-duplicate logic; consolidate only when the shared concept is real.
- Capture concrete context once at the start of async work.
- Treat reduced code, branching, and compatibility machinery as refactor deliverables.

## Tool Calling

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
