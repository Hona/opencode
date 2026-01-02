# OpenTelemetry + Aspire Dashboard Integration Plan

## Overview

Add structured logging and tracing via OpenTelemetry to OpenCode, viewable in real-time via the .NET Aspire Dashboard. This enables live tail on logs and distributed tracing for debugging performance, bugs, and understanding system behavior during local development.

**Key Design Decisions:**

- Extend existing `experimental.openTelemetry` config flag
- Support `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable
- Keep file-based logging in parallel (backward compatible)
- Use gRPC OTLP protocol for Aspire Dashboard compatibility
- Span naming convention: `{category}.{operation}` (e.g., `tool.bash.execute`)

---

## Phase 1: Dependencies & Scripts

### 1.1 Add OpenTelemetry Dependencies

- [x] Add `@opentelemetry/api` to dependencies in `packages/opencode/package.json`
- [x] Add `@opentelemetry/api-logs` to dependencies
- [x] Add `@opentelemetry/sdk-node` to dependencies
- [x] Add `@opentelemetry/sdk-logs` to dependencies
- [x] Add `@opentelemetry/resources` to dependencies
- [x] Add `@opentelemetry/semantic-conventions` to dependencies
- [x] Add `@opentelemetry/exporter-trace-otlp-grpc` to dependencies
- [x] Add `@opentelemetry/exporter-logs-otlp-grpc` to dependencies
- [x] Run `bun install` to install dependencies

### 1.2 Add npm Scripts

- [x] Add `aspire:start` script to `packages/opencode/package.json`:
  ```
  docker run --rm -d -p 18888:18888 -p 4317:18889 -e ASPIRE_DASHBOARD_UNSECURED_ALLOW_ANONYMOUS=true --name aspire-dashboard mcr.microsoft.com/dotnet/aspire-dashboard:latest && echo 'Aspire Dashboard: http://localhost:18888'
  ```
- [x] Add `aspire:stop` script: `docker stop aspire-dashboard 2>/dev/null || true`
- [x] Add `dev:otel` script: `bun run aspire:start; OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 bun dev`

---

## Phase 2: Configuration

### 2.1 Extend Config Schema

- [x] Open `packages/opencode/src/config/config.ts`
- [x] Locate the `openTelemetry` field in the `experimental` object (~line 912)
- [x] Change from `z.boolean().optional()` to:
  ```typescript
  openTelemetry: z.union([
    z.boolean(),
    z.object({
      enabled: z.boolean().optional().default(true),
      endpoint: z.string().optional().describe("OTLP endpoint (default: http://localhost:4317)"),
    }),
  ])
    .optional()
    .describe("Enable OpenTelemetry tracing and structured logs to Aspire Dashboard")
  ```
- [x] Update the description to reflect new capabilities

---

## Phase 3: Telemetry Module

### 3.1 Create Telemetry Module Structure

- [x] Create new file `packages/opencode/src/telemetry/index.ts`
- [x] Add namespace `Telemetry` export

### 3.2 Implement Configuration Resolution

- [x] Add `Config` interface with `enabled`, `endpoint`, `serviceName` fields
- [x] Implement `resolveConfig()` helper that checks:
  1. `OTEL_EXPORTER_OTLP_ENDPOINT` env var (highest priority)
  2. Config object endpoint
  3. Default: `http://localhost:4317`

### 3.3 Implement SDK Initialization

- [x] Add `let sdk: NodeSDK | undefined` module-level variable
- [x] Add `let loggerProvider: LoggerProvider | undefined` module-level variable
- [x] Add `let initialized = false` flag
- [x] Implement `init(config: Config)` function:
  - Create `Resource` with `service.name` = "opencode" and `service.version` from Installation.VERSION
  - Create `OTLPTraceExporter` with endpoint
  - Create `OTLPLogExporter` with endpoint
  - Create `LoggerProvider` with `BatchLogRecordProcessor`
  - Set global logger provider via `logs.setGlobalLoggerProvider()`
  - Create `NodeSDK` with trace exporter
  - Call `sdk.start()`
  - Set `initialized = true`
  - Wrap in try/catch - on error, log error message and continue without telemetry

### 3.4 Implement Shutdown

- [x] Implement `shutdown(): Promise<void>` function
- [x] Call `sdk?.shutdown()` and `loggerProvider?.shutdown()` in parallel
- [x] Handle errors gracefully

### 3.5 Implement Helper Functions

- [x] Implement `isEnabled(): boolean` - returns `initialized`
- [x] Implement `getTracer(name: string)` - returns `trace.getTracer(name)`
- [x] Implement `getLogger(name: string)` - returns `logs.getLogger(name)`

### 3.6 Implement withSpan Helper

- [x] Implement `withSpan<T>(name: string, attributes: Record<string, AttributeValue>, fn: (span: Span) => Promise<T>): Promise<T>`
- [x] If not enabled, just call `fn()` with a no-op span
- [x] If enabled:
  - Start span with name and attributes
  - Try to execute fn, passing span
  - On success, end span normally
  - On error, record exception on span, set error status, end span, rethrow
- [x] Ensure span is always ended in finally block

---

## Phase 4: Logging Bridge

### 4.1 Add OTEL Logging to Log Module

- [x] Open `packages/opencode/src/util/log.ts`
- [x] Add import for `Telemetry` (use dynamic import to avoid circular deps)
- [x] Add `SeverityNumber` mapping: `{ DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17 }`

### 4.2 Create OTEL Log Emission Helper

- [x] Add `emitOtelLog(level: Level, message: string, attributes: Record<string, any>)` function
- [x] Check `Telemetry.isEnabled()` first
- [x] Get logger via `Telemetry.getLogger("opencode")`
- [x] Call `logger.emit()` with:
  - `severityNumber` from mapping
  - `severityText` = level
  - `body` = message
  - `attributes` = provided attributes

### 4.3 Integrate into Logger Methods

- [x] In `debug()` method: call `emitOtelLog("DEBUG", message, { ...tags, ...extra })` after file write
- [x] In `info()` method: call `emitOtelLog("INFO", message, { ...tags, ...extra })` after file write
- [x] In `warn()` method: call `emitOtelLog("WARN", message, { ...tags, ...extra })` after file write
- [x] In `error()` method: call `emitOtelLog("ERROR", message, { ...tags, ...extra })` after file write

---

## Phase 5: Startup Integration

### 5.1 Initialize Telemetry on Startup

- [x] Open `packages/opencode/src/index.ts`
- [x] In the yargs middleware (after `Log.init()`), add telemetry initialization:
  - Check if `process.env.OTEL_EXPORTER_OTLP_ENDPOINT` is set
  - If not, load config and check `cfg.experimental?.openTelemetry`
  - If either is truthy, dynamically import `./telemetry`
  - Call `Telemetry.init()` with resolved config

### 5.2 Register Shutdown Handlers

- [x] Add `process.on("SIGTERM", async () => { await Telemetry.shutdown() })`
- [x] Add `process.on("SIGINT", async () => { await Telemetry.shutdown() })`
- [x] Ensure shutdown is called before `process.exit()` in the finally block

---

## Phase 6: Tool Instrumentation

### 6.1 Bash Tool

- [x] Open `packages/opencode/src/tool/bash.ts`
- [x] Import `Telemetry` from `@/telemetry`
- [x] Wrap `execute` function body with `Telemetry.withSpan("tool.bash.execute", {...}, async (span) => { ... })`
- [x] Add attributes: `tool.name`, `session.id`, `tool.command` (truncated), `tool.workdir`, `tool.timeout`
- [x] Set `tool.exit_code` and `tool.timed_out` on span before returning

### 6.2 Read Tool

- [x] Open `packages/opencode/src/tool/read.ts`
- [x] Import `Telemetry`
- [x] Wrap `execute` with `Telemetry.withSpan("tool.read.execute", {...}, ...)`
- [x] Add attributes: `tool.name`, `session.id`, `tool.file_path`, `tool.offset`, `tool.limit`
- [x] Set `tool.lines_read`, `tool.is_binary`, `tool.is_image` on completion

### 6.3 Edit Tool

- [x] Open `packages/opencode/src/tool/edit.ts`
- [x] Import `Telemetry`
- [x] Wrap `execute` with `Telemetry.withSpan("tool.edit.execute", {...}, ...)`
- [x] Add attributes: `tool.name`, `session.id`, `tool.file_path`, `tool.replace_all`
- [x] Set `tool.additions`, `tool.deletions` on completion

### 6.4 Write Tool

- [x] Open `packages/opencode/src/tool/write.ts`
- [x] Import `Telemetry`
- [x] Wrap `execute` with `Telemetry.withSpan("tool.write.execute", {...}, ...)`
- [x] Add attributes: `tool.name`, `session.id`, `tool.file_path`, `tool.content_length`

### 6.5 Glob Tool

- [x] Open `packages/opencode/src/tool/glob.ts`
- [x] Import `Telemetry`
- [x] Wrap `execute` with `Telemetry.withSpan("tool.glob.execute", {...}, ...)`
- [x] Add attributes: `tool.name`, `session.id`, `tool.pattern`, `tool.path`
- [x] Set `tool.files_found`, `tool.truncated` on completion

### 6.6 Grep Tool

- [x] Open `packages/opencode/src/tool/grep.ts`
- [x] Import `Telemetry`
- [x] Wrap `execute` with `Telemetry.withSpan("tool.grep.execute", {...}, ...)`
- [x] Add attributes: `tool.name`, `session.id`, `tool.pattern`, `tool.path`, `tool.include`
- [x] Set `tool.matches_found`, `tool.truncated` on completion

### 6.7 WebFetch Tool

- [x] Open `packages/opencode/src/tool/webfetch.ts`
- [x] Import `Telemetry`
- [x] Wrap `execute` with `Telemetry.withSpan("tool.webfetch.execute", {...}, ...)`
- [x] Add attributes: `tool.name`, `session.id`, `tool.url`, `tool.format`, `tool.timeout`
- [x] Set `http.status_code` on completion

### 6.8 WebSearch Tool

- [x] Open `packages/opencode/src/tool/websearch.ts`
- [x] Import `Telemetry`
- [x] Wrap `execute` with `Telemetry.withSpan("tool.websearch.execute", {...}, ...)`
- [x] Add attributes: `tool.name`, `session.id`, `tool.query`, `tool.num_results`, `tool.type`
- [x] Set `http.status_code` on completion

### 6.9 CodeSearch Tool

- [x] Open `packages/opencode/src/tool/codesearch.ts`
- [x] Import `Telemetry`
- [x] Wrap `execute` with `Telemetry.withSpan("tool.codesearch.execute", {...}, ...)`
- [x] Add attributes: `tool.name`, `session.id`, `tool.query`, `tool.tokens_num`
- [x] Set `http.status_code` on completion

### 6.10 Task Tool

- [x] Open `packages/opencode/src/tool/task.ts`
- [x] Import `Telemetry`
- [x] Wrap `execute` with `Telemetry.withSpan("tool.task.execute", {...}, ...)`
- [x] Add attributes: `tool.name`, `session.id`, `tool.description`, `tool.subagent_type`
- [x] Set `tool.child_session_id` on completion

### 6.11 LSP Tool

- [x] Open `packages/opencode/src/tool/lsp.ts`
- [x] Import `Telemetry`
- [x] Wrap `execute` with `Telemetry.withSpan("tool.lsp.execute", {...}, ...)`
- [x] Add attributes: `tool.name`, `session.id`, `tool.operation`, `tool.file_path`
- [x] Set `tool.result_count` on completion

### 6.12 Skill Tool

- [x] Open `packages/opencode/src/tool/skill.ts`
- [x] Import `Telemetry`
- [x] Wrap `execute` with `Telemetry.withSpan("tool.skill.execute", {...}, ...)`
- [x] Add attributes: `tool.name`, `session.id`, `tool.skill_name`

### 6.13 List Tool

- [x] Open `packages/opencode/src/tool/ls.ts`
- [x] Import `Telemetry`
- [x] Wrap `execute` with `Telemetry.withSpan("tool.list.execute", {...}, ...)`
- [x] Add attributes: `tool.name`, `session.id`, `tool.path`
- [x] Set `tool.files_found`, `tool.truncated` on completion

### 6.14 Batch Tool

- [x] Open `packages/opencode/src/tool/batch.ts`
- [x] Import `Telemetry`
- [x] Wrap `execute` with `Telemetry.withSpan("tool.batch.execute", {...}, ...)`
- [x] Add attributes: `tool.name`, `session.id`, `tool.total_calls`
- [x] Set `tool.successful_calls`, `tool.failed_calls` on completion

### 6.15 MultiEdit Tool

- [x] Open `packages/opencode/src/tool/multiedit.ts`
- [x] Import `Telemetry`
- [x] Wrap `execute` with `Telemetry.withSpan("tool.multiedit.execute", {...}, ...)`
- [x] Add attributes: `tool.name`, `session.id`, `tool.file_path`, `tool.edit_count`

### 6.16 TodoWrite Tool

- [x] Open `packages/opencode/src/tool/todo.ts` (note: both tools are in the same file)
- [x] Import `Telemetry`
- [x] Wrap `execute` with `Telemetry.withSpan("tool.todowrite.execute", {...}, ...)`
- [x] Add attributes: `tool.name`, `session.id`, `tool.todo_count`

### 6.17 TodoRead Tool

- [x] Open `packages/opencode/src/tool/todo.ts` (note: both tools are in the same file)
- [x] Import `Telemetry`
- [x] Wrap `execute` with `Telemetry.withSpan("tool.todoread.execute", {...}, ...)`
- [x] Add attributes: `tool.name`, `session.id`

---

## Phase 7: MCP Instrumentation

### 7.1 MCP Client Connect

- [x] Open `packages/opencode/src/mcp/index.ts`
- [x] Import `Telemetry`
- [x] Find `client.connect(transport)` call in `create()` function
- [x] Wrap with `Telemetry.withSpan("mcp.client.connect", {...}, ...)`
- [x] Add attributes: `mcp.server_name`, `mcp.type` (local/remote)

### 7.2 MCP Tool Call

- [x] Find `client.callTool()` call in `convertMcpTool` execute wrapper
- [x] Wrap with `Telemetry.withSpan("mcp.tool.call", {...}, ...)`
- [x] Add attributes: `mcp.server_name`, `mcp.tool_name`

### 7.3 MCP List Tools

- [x] Find `mcpClient.listTools()` call
- [x] Wrap with `Telemetry.withSpan("mcp.tools.list", {...}, ...)`
- [x] Add attributes: `mcp.server_name`
- [x] Set `mcp.tool_count` on completion

### 7.4 MCP List Prompts

- [x] Find `client.listPrompts()` call
- [x] Wrap with `Telemetry.withSpan("mcp.prompts.list", {...}, ...)`
- [x] Add attributes: `mcp.server_name`
- [x] Set `mcp.prompt_count` on completion

### 7.5 MCP Get Prompt

- [x] Find `client.getPrompt()` call
- [x] Wrap with `Telemetry.withSpan("mcp.prompt.get", {...}, ...)`
- [x] Add attributes: `mcp.server_name`, `mcp.prompt_name`

---

## Phase 8: Session/LLM Instrumentation

### 8.1 LLM Stream

- [x] Open `packages/opencode/src/session/llm.ts`
- [x] Import `Telemetry`
- [x] Wrap `stream()` function body with `Telemetry.withSpan("llm.stream", {...}, ...)`
- [x] Add attributes: `llm.provider_id`, `llm.model_id`, `session.id`, `llm.agent`, `llm.tools_count`

### 8.2 Session Processor

- [x] Open `packages/opencode/src/session/processor.ts`
- [x] Import `Telemetry`
- [x] Wrap `process()` function with `Telemetry.withSpan("session.processor.process", {...}, ...)`
- [x] Add attributes: `session.id`, `session.message_id`, `llm.model_id`, `llm.provider_id`

### 8.3 Session Prompt

- [x] Open `packages/opencode/src/session/prompt.ts`
- [x] Import `Telemetry`
- [x] Wrap `prompt()` function with `Telemetry.withSpan("session.prompt", {...}, ...)`
- [x] Add attributes: `session.id`, `session.agent`, `llm.provider_id`, `llm.model_id`

### 8.4 Session Prompt Loop

- [x] Find `loop()` function in `packages/opencode/src/session/prompt.ts`
- [x] Wrap with `Telemetry.withSpan("session.prompt.loop", {...}, ...)`
- [x] Add attributes: `session.id`, `session.step`, `session.agent`

### 8.5 Session Compaction

- [x] Open `packages/opencode/src/session/compaction.ts`
- [x] Import `Telemetry`
- [x] Wrap `process()` function with `Telemetry.withSpan("session.compaction.process", {...}, ...)`
- [x] Add attributes: `session.id`, `session.auto`, `session.message_count`

### 8.6 Session Summary

- [x] Open `packages/opencode/src/session/summary.ts`
- [x] Import `Telemetry`
- [x] Wrap `summarize()` function with `Telemetry.withSpan("session.summary", {...}, ...)`
- [x] Add attributes: `session.id`, `session.message_id`

---

## Phase 9: LSP Instrumentation

### 9.1 LSP Client Create

- [ ] Open `packages/opencode/src/lsp/client.ts`
- [ ] Import `Telemetry`
- [ ] Wrap `create()` function with `Telemetry.withSpan("lsp.client.create", {...}, ...)`
- [ ] Add attributes: `lsp.server_id`, `lsp.root`

### 9.2 LSP Initialize Request

- [ ] Find `connection.sendRequest("initialize", ...)` in `create()`
- [ ] Wrap with `Telemetry.withSpan("lsp.request.initialize", {...}, ...)`
- [ ] Add attributes: `lsp.server_id`

### 9.3 LSP Touch File

- [ ] Open `packages/opencode/src/lsp/index.ts`
- [ ] Import `Telemetry`
- [ ] Wrap `touchFile()` function with `Telemetry.withSpan("lsp.touch_file", {...}, ...)`
- [ ] Add attributes: `lsp.file`

### 9.4 LSP Definition

- [ ] Find `definition()` function
- [ ] Wrap with `Telemetry.withSpan("lsp.request.definition", {...}, ...)`
- [ ] Add attributes: `lsp.file`, `lsp.line`, `lsp.character`

### 9.5 LSP References

- [ ] Find `references()` function
- [ ] Wrap with `Telemetry.withSpan("lsp.request.references", {...}, ...)`
- [ ] Add attributes: `lsp.file`, `lsp.line`, `lsp.character`

### 9.6 LSP Hover

- [ ] Find `hover()` function
- [ ] Wrap with `Telemetry.withSpan("lsp.request.hover", {...}, ...)`
- [ ] Add attributes: `lsp.file`, `lsp.line`, `lsp.character`

---

## Phase 10: Other Instrumentation

### 10.1 Agent Generate

- [ ] Open `packages/opencode/src/agent/agent.ts`
- [ ] Import `Telemetry`
- [ ] Wrap `generate()` function with `Telemetry.withSpan("agent.generate", {...}, ...)`
- [ ] Add attributes: `llm.provider_id`, `llm.model_id`

### 10.2 Plugin Trigger

- [ ] Open `packages/opencode/src/plugin/index.ts`
- [ ] Import `Telemetry`
- [ ] Wrap `trigger()` function with `Telemetry.withSpan("plugin.trigger", {...}, ...)`
- [ ] Add attributes: `plugin.hook_name`, `plugin.hooks_count`

### 10.3 Snapshot Track

- [ ] Open `packages/opencode/src/snapshot/index.ts`
- [ ] Import `Telemetry`
- [ ] Wrap `track()` function with `Telemetry.withSpan("snapshot.track", {...}, ...)`
- [ ] Add attributes: `snapshot.vcs`
- [ ] Set `snapshot.hash` on completion

### 10.4 Snapshot Restore

- [ ] Find `restore()` function
- [ ] Wrap with `Telemetry.withSpan("snapshot.restore", {...}, ...)`
- [ ] Add attributes: `snapshot.hash`

---

## Phase 11: Testing & Validation

### 11.1 Manual Testing

- [ ] Run `bun run aspire:start` and verify dashboard is accessible at http://localhost:18888
- [ ] Run `bun run dev:otel` and verify no startup errors
- [ ] Make a simple request in OpenCode (e.g., "list files in current directory")
- [ ] Verify logs appear in Aspire Dashboard "Structured Logs" tab
- [ ] Verify traces appear in Aspire Dashboard "Traces" tab
- [ ] Verify spans have correct names and attributes
- [ ] Run `bun run aspire:stop` to clean up

### 11.2 Error Handling Validation

- [ ] Stop Aspire Dashboard
- [ ] Run OpenCode with `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317`
- [ ] Verify error is logged but OpenCode continues to function
- [ ] Verify file-based logging still works

### 11.3 Config Validation

- [ ] Test with `experimental.openTelemetry: true` in config
- [ ] Test with `experimental.openTelemetry: { endpoint: "http://localhost:4317" }` in config
- [ ] Verify both forms work correctly

---

## Phase 12: Cleanup & Documentation

### 12.1 Code Cleanup

- [ ] Remove any debug console.log statements added during development
- [ ] Ensure consistent formatting across all modified files
- [ ] Run `bun run typecheck` in packages/opencode to verify no type errors

### 12.2 Update AGENTS.md (Optional)

- [ ] Add brief section about running with Aspire Dashboard for observability
- [ ] Document the `dev:otel` script

---

## Notes for Implementers

### Import Pattern

```typescript
import { Telemetry } from "@/telemetry"
```

### Span Wrapper Pattern

```typescript
export async function execute(params: Params, ctx: Context) {
  return Telemetry.withSpan(
    "tool.example.execute",
    {
      "tool.name": "example",
      "session.id": ctx.sessionID,
      "tool.param": params.something,
    },
    async (span) => {
      // existing function body
      const result = await doWork()

      // optionally add more attributes based on result
      span.setAttributes({
        "tool.result_count": result.length,
      })

      return result
    },
  )
}
```

### If Telemetry Not Enabled

The `withSpan` helper should be a no-op when telemetry is disabled - it should just call the function directly without any overhead.

### Attribute Naming Convention

- Use dot notation: `tool.name`, `session.id`, `llm.model_id`
- Use snake_case for multi-word attributes: `tool.file_path`, `tool.exit_code`
- Common prefixes: `tool.`, `session.`, `llm.`, `mcp.`, `lsp.`, `http.`, `snapshot.`, `plugin.`
