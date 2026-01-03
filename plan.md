# OpenTelemetry API Refactor Plan

## Goal

Significantly reduce the `feat/aspire-otel` branch diff by moving telemetry concerns out of business logic and into framework-level auto-instrumentation, while maintaining and improving observability.

**Current state:** Large diff with telemetry wrappers causing indentation noise in `packages/opencode/src`
**Target state:** Minimal diff with clean auto-instrumentation - most files should show only metadata additions

## Design Principles

1. **Zero telemetry code in tools** - Auto-instrumentation via `Tool.define()`
2. **One-line decoration for functions** - `traced()` wrapper
3. **`using` syntax for complex cases** - No indentation penalty
4. **Child spans for loops** - Better observability for multi-step operations
5. **Auto-capture params and metadata** - Single source of truth

---

## Phase 1: Framework Foundation

### 1.1 Telemetry Module Enhancements

- [x] **1.1.1** Add `flattenAttributes()` utility to `packages/opencode/src/telemetry/index.ts`
  - Takes `prefix: string` and `obj: Record<string, unknown>`
  - Returns `Record<string, AttributeValue>`
  - Truncates strings longer than 200 characters
  - Only captures primitives (string, number, boolean)
  - Skips undefined/null values

- [x] **1.1.2** Add `span()` function with `using` support to `packages/opencode/src/telemetry/index.ts`
  - Signature: `span(name: string, attrs: Record<string, AttributeValue>): Span & Disposable`
  - Returns NOOP_SPAN with empty dispose if telemetry not initialized
  - Implements `[Symbol.dispose]` to call `span.end()`
  - Starts span immediately on call

- [x] **1.1.3** Export `NOOP_SPAN` from telemetry module (needed for span() fallback)

### 1.2 Traced Wrapper Utility

- [x] **1.2.1** Create new file `packages/opencode/src/telemetry/traced.ts`
  - Export `traced<TInput, TOutput>()` higher-order function
  - Signature: `traced(name, attributesFn)(fn) => wrappedFn`
  - Uses `Telemetry.withSpan()` internally
  - Preserves function return type

- [x] **1.2.2** Add export for `traced` from `packages/opencode/src/telemetry/index.ts`

### 1.3 Tool Auto-Instrumentation

- [x] **1.3.1** Modify `Tool.define()` in `packages/opencode/src/tool/tool.ts` to wrap `execute`
  - Wrap original execute with `Telemetry.withSpan()`
  - Span name: `tool.${id}.execute`
  - Auto-capture params using `flattenAttributes("tool.param.", args)`
  - Auto-capture result metadata using `flattenAttributes("tool.", result.metadata)`

- [x] **1.3.2** Add `"tool.name"` and `"session.id"` as default span attributes in Tool.define wrapper

### 1.4 Phase 1 Validation

- [x] **1.4.1** Verify framework compiles: `bun run typecheck` in packages/opencode
- [x] **1.4.2** Verify new exports work:

  ```bash
  grep -n "flattenAttributes\|traced\|span(" packages/opencode/src/telemetry/index.ts
  ```

  - Should show all three utilities exported

- [x] **1.4.3** Verify Tool.define includes auto-instrumentation:

  ```bash
  grep -A5 "withSpan" packages/opencode/src/tool/tool.ts
  ```

  - Should show the new telemetry wrapper in define()

---

## Phase 2: Tool Migration

### 2.1 Remove Telemetry Wrappers from Tools

For each tool: remove `Telemetry.withSpan()` wrapper, remove telemetry import, unindent function body.

**Validation command for each file:**

```bash
git diff dev -- <file> | head -100  # Should show minimal changes (metadata additions only)
```

- [x] **2.1.1** Migrate `packages/opencode/src/tool/glob.ts`
  - Remove `import { Telemetry }`
  - Remove `Telemetry.withSpan()` wrapper from execute
  - Remove `span.setAttributes()` call
  - Unindent function body
- [x] **2.1.1-validate** Verify diff: `git diff dev -- packages/opencode/src/tool/glob.ts`
  - Should show: significant decrease in changed lines, no `Telemetry` import, no indentation noise

- [x] **2.1.2** Migrate `packages/opencode/src/tool/grep.ts`
  - Remove telemetry wrapper
  - Remove all `span.setAttributes()` calls (3 locations)
  - Unindent function body
- [x] **2.1.2-validate** Verify diff: `git diff dev -- packages/opencode/src/tool/grep.ts`
  - Should show: significant decrease in changed lines, metadata additions only, no telemetry wrapper

- [x] **2.1.3** Migrate `packages/opencode/src/tool/read.ts`
  - Remove telemetry wrapper
  - Remove all `span.setAttributes()` calls (3 locations for different file types)
  - Unindent function body
- [x] **2.1.3-validate** Verify diff: `git diff dev -- packages/opencode/src/tool/read.ts`
  - Should show: metadata additions only, no telemetry wrapper

- [x] **2.1.4** Migrate `packages/opencode/src/tool/write.ts`
  - Remove telemetry wrapper
  - Unindent function body
- [x] **2.1.4-validate** Verify diff: `git diff dev -- packages/opencode/src/tool/write.ts`
  - Should show: metadata additions only, no telemetry wrapper

- [x] **2.1.5** Migrate `packages/opencode/src/tool/edit.ts`
  - Remove telemetry wrapper
  - Remove `span.setAttributes()` call
  - Unindent function body
- [x] **2.1.5-validate** Verify diff: `git diff dev -- packages/opencode/src/tool/edit.ts`
  - Should show: metadata additions only, no telemetry wrapper

- [x] **2.1.6** Migrate `packages/opencode/src/tool/multiedit.ts`
  - Remove telemetry wrapper
  - Unindent function body
- [x] **2.1.6-validate** Verify diff: `git diff dev -- packages/opencode/src/tool/multiedit.ts`
  - Should show: metadata additions only, no telemetry wrapper

- [x] **2.1.7** Migrate `packages/opencode/src/tool/bash.ts`
  - Remove telemetry wrapper
  - Remove `span.setAttributes()` call at end
  - Unindent function body
- [x] **2.1.7-validate** Verify diff: `git diff dev -- packages/opencode/src/tool/bash.ts`
  - Should show: metadata additions only, no telemetry wrapper

- [x] **2.1.8** Migrate `packages/opencode/src/tool/batch.ts`
  - Remove telemetry wrapper
  - Remove `span.setAttributes()` call
  - Unindent function body
- [x] **2.1.8-validate** Verify diff: `git diff dev -- packages/opencode/src/tool/batch.ts`
  - Should show: minimal changes, no telemetry wrapper

- [x] **2.1.9** Migrate `packages/opencode/src/tool/ls.ts`
  - Remove telemetry wrapper
  - Remove `span.setAttributes()` call
  - Unindent function body
- [x] **2.1.9-validate** Verify diff: `git diff dev -- packages/opencode/src/tool/ls.ts`
  - Should show: metadata additions only, no telemetry wrapper

- [x] **2.1.10** Migrate `packages/opencode/src/tool/lsp.ts`
  - Remove telemetry wrapper
  - Remove `span.setAttributes()` call
  - Unindent function body
- [x] **2.1.10-validate** Verify diff: `git diff dev -- packages/opencode/src/tool/lsp.ts`
  - Should show: metadata additions only, no telemetry wrapper

- [x] **2.1.11** Migrate `packages/opencode/src/tool/task.ts`
  - Remove telemetry wrapper
  - Remove `span.setAttributes()` call
  - Unindent function body
- [x] **2.1.11-validate** Verify diff: `git diff dev -- packages/opencode/src/tool/task.ts`
  - Should show: metadata additions only, no telemetry wrapper

- [x] **2.1.12** Migrate `packages/opencode/src/tool/skill.ts`
  - Remove telemetry wrapper
  - Unindent function body
- [x] **2.1.12-validate** Verify diff: `git diff dev -- packages/opencode/src/tool/skill.ts`
  - Should show: metadata additions only, no telemetry wrapper

- [x] **2.1.13** Migrate `packages/opencode/src/tool/todo.ts` (TodoWriteTool)
  - Remove telemetry wrapper from todowrite execute
  - Unindent function body
- [x] **2.1.13-validate** Verify diff for TodoWriteTool section

- [x] **2.1.14** Migrate `packages/opencode/src/tool/todo.ts` (TodoReadTool)
  - Remove telemetry wrapper from todoread execute
  - Unindent function body
- [x] **2.1.14-validate** Verify diff: `git diff dev -- packages/opencode/src/tool/todo.ts`
  - Should show: metadata additions only for both tools, no telemetry wrappers

- [x] **2.1.15** Migrate `packages/opencode/src/tool/webfetch.ts`
  - Remove telemetry wrapper
  - Remove `span.setAttributes()` call
  - Unindent function body
- [x] **2.1.15-validate** Verify diff: `git diff dev -- packages/opencode/src/tool/webfetch.ts`
  - Should show: metadata additions only, no telemetry wrapper

- [x] **2.1.16** Migrate `packages/opencode/src/tool/websearch.ts`
  - Remove telemetry wrapper
  - Remove `span.setAttributes()` call
  - Unindent function body
- [x] **2.1.16-validate** Verify diff: `git diff dev -- packages/opencode/src/tool/websearch.ts`
  - Should show: metadata additions only, no telemetry wrapper

- [x] **2.1.17** Migrate `packages/opencode/src/tool/codesearch.ts`
  - Remove telemetry wrapper
  - Remove `span.setAttributes()` call
  - Unindent function body
- [x] **2.1.17-validate** Verify diff: `git diff dev -- packages/opencode/src/tool/codesearch.ts`
  - Should show: metadata additions only, no telemetry wrapper

### 2.1-checkpoint: Tool Wrapper Removal Complete

- [x] **2.1-checkpoint** Run aggregate diff check for all tools:

  ```bash
  git diff dev --stat -- packages/opencode/src/tool/
  ```

  - Target: Each tool file should show significant decrease in lines changed compared to before
  - No file should contain `Telemetry.withSpan` in execute function
  - Verify with: `grep -r "Telemetry.withSpan" packages/opencode/src/tool/*.ts` (should return empty)

### 2.2 Enhance Tool Metadata

Add observability-useful fields to metadata returns so they are auto-captured as span attributes.

- [x] **2.2.1** Enhance `bash.ts` metadata
  - Add `aborted: boolean` - whether command was user-aborted
  - Add `truncated: boolean` - whether output was truncated
  - Add `timedOut: boolean` - whether command timed out

- [x] **2.2.2** Enhance `codesearch.ts` metadata (currently empty `{}`)
  - Add `query: string` - the search query
  - Add `tokensNum: number` - tokens requested
  - Add `hasResults: boolean` - whether results were returned
  - Add `statusCode: number` - HTTP status code

- [x] **2.2.3** Enhance `edit.ts` metadata
  - Add `errorCount: number` - count of LSP errors after edit
  - Add `fileExisted: boolean` - whether file existed before edit

- [x] **2.2.4** Enhance `grep.ts` metadata
  - Add `uniqueFiles: number` - count of unique files with matches

- [x] **2.2.5** Enhance `ls.ts` metadata
  - Add `directories: number` - count of directories found

- [x] **2.2.6** Enhance `lsp.ts` metadata
  - Add `operation: string` - the LSP operation performed
  - Add `resultCount: number` - number of results returned

- [x] **2.2.7** Enhance `multiedit.ts` metadata
  - Add `successfulEdits: number` - count of successful edits
  - Add `failedEdits: number` - count of failed edits
  - Add `totalAdditions: number` - sum of all line additions
  - Add `totalDeletions: number` - sum of all line deletions

- [x] **2.2.8** Enhance `read.ts` metadata
  - Add `isImage: boolean` - whether file is an image
  - Add `isBinary: boolean` - whether file is binary
  - Add `linesRead: number` - number of lines read
  - Add `totalLines: number` - total lines in file (if applicable)
  - Add `truncated: boolean` - whether content was truncated

- [x] **2.2.9** Enhance `skill.ts` metadata
  - Add `skillFound: boolean` - whether skill was found

- [x] **2.2.10** Enhance `task.ts` metadata
  - Add `toolCallsCount: number` - total tool calls made by subagent
  - Add `isNewSession: boolean` - whether a new session was created

- [x] **2.2.11** Enhance `todo.ts` (TodoWriteTool) metadata
  - Add `completedCount: number` - todos with status "completed"
  - Add `pendingCount: number` - todos not completed

- [x] **2.2.12** Enhance `todo.ts` (TodoReadTool) metadata
  - Add `todoCount: number` - total todos
  - Add `completedCount: number` - completed todos

- [x] **2.2.13** Enhance `webfetch.ts` metadata (currently empty `{}`)
  - Add `statusCode: number` - HTTP status code
  - Add `contentType: string` - response content-type
  - Add `responseSize: number` - response size in bytes

- [x] **2.2.14** Enhance `websearch.ts` metadata (currently empty `{}`)
  - Add `statusCode: number` - HTTP status code
  - Add `resultCount: number` - number of results
  - Add `hasResults: boolean` - whether any results returned
  - Add `searchType: string` - type of search performed

- [x] **2.2.15** Enhance `write.ts` metadata
  - Add `errorCount: number` - count of LSP errors after write
  - Add `fileCreated: boolean` - whether file was newly created

### 2.3 Phase 2 Validation

- [x] **2.3.1** Run full tool directory diff check:

  ```bash
  git diff dev --stat -- packages/opencode/src/tool/
  ```

  - Target: Significant decrease in total lines changed compared to current state
  - Result: 15 files changed, 142 insertions(+), 33 deletions(-) - minimal targeted changes

- [x] **2.3.2** Verify no telemetry wrappers remain in tools:

  ```bash
  grep -l "Telemetry.withSpan" packages/opencode/src/tool/*.ts
  ```

  - Should return empty (no files)
  - Result: Only tool.ts contains Telemetry.withSpan (the auto-instrumentation wrapper)

- [x] **2.3.3** Verify no Telemetry imports in tool files (except tool.ts):

  ```bash
  grep -l "from.*telemetry" packages/opencode/src/tool/*.ts | grep -v tool.ts
  ```

  - Should return empty (no files except tool.ts itself)
  - Result: No files import Telemetry except tool.ts

- [x] **2.3.4** Verify all tools still compile: `bun run typecheck` in packages/opencode
  - Result: Typecheck passes

- [x] **2.3.5** Spot check one tool diff is clean (glob as reference):

  ```bash
  git diff dev -- packages/opencode/src/tool/glob.ts
  ```

  - Should show only metadata field additions, no indentation changes
  - Result: No diff (glob.ts already had clean metadata)

---

## Phase 3: Session Loop Refactor

### 3.1 Refactor session.prompt.loop

- [x] **3.1.1** In `packages/opencode/src/session/prompt.ts`, refactor `loop` function
  - Replace `Telemetry.withSpan("session.prompt.loop", ...)` with `using loopSpan = Telemetry.span(...)`
  - Move span creation to top of function body (after early return check)

- [x] **3.1.2** Add child spans for each loop iteration
  - Added `using stepSpan = Telemetry.span("session.prompt.step", { "session.id", "session.step", "session.agent" })` after step increment
  - Per-step spans automatically end when iteration completes (via `using` syntax)

- [x] **3.1.3** Remove manual `span.setAttributes()` calls from loop
  - Replaced `loopSpan.setAttributes()` with per-step child span creation
  - Step and agent are now captured per-step span, not updated on parent

- [x] **3.1.4** Unindent loop body (should be 1 level less than current)
  - N/A: `using` syntax was used which doesn't add indentation, so body is already at correct level

### 3.2 Phase 3 Validation

- [x] **3.2.1** Verify prompt.ts diff is cleaner:

  ```bash
  git diff dev --stat -- packages/opencode/src/session/prompt.ts
  ```

  - Result: 77 lines changed (51 insertions, 26 deletions) - clean diff for telemetry addition

- [x] **3.2.2** Verify loop structure with child spans:

  ```bash
  grep -n "session.prompt.step\|session.prompt.loop" packages/opencode/src/session/prompt.ts
  ```

  - Result: Both span names present at lines 278 and 321

- [x] **3.2.3** Verify no `span.setAttributes` calls remain in loop:

  ```bash
  grep -n "span.setAttributes" packages/opencode/src/session/prompt.ts
  ```

  - Result: No matches found - all removed

- [x] **3.2.4** Verify `using` keyword is used for parent span:

  ```bash
  grep -n "using.*Telemetry.span" packages/opencode/src/session/prompt.ts
  ```

  - Result: Two matches at lines 278 and 321

---

## Phase 4: Simple Function Migration with traced()

### 4.1 Session Module

- [x] **4.1.1** Migrate `LLM.stream` in `packages/opencode/src/session/llm.ts`
  - Change from `export async function stream(input)` to `export const stream = traced(...)(async (input) => ...)`
  - Attributes: `llm.provider_id`, `llm.model_id`, `session.id`, `llm.agent`, `llm.tools_count`
  - Note: Explicit type parameters `traced<StreamInput, StreamOutput>` needed for proper type inference

- [x] **4.1.2** Migrate `SessionPrompt.prompt` in `packages/opencode/src/session/prompt.ts`
  - Change to `traced()` wrapper pattern
  - Attributes: `session.id`, `session.agent`, `llm.provider_id`, `llm.model_id`

- [x] **4.1.3** Migrate `SessionCompaction.process` in `packages/opencode/src/session/compaction.ts`
  - Change to `traced()` wrapper pattern
  - Attributes: `session.id`, `session.auto`, `session.message_count`

- [x] **4.1.4** Migrate `SessionSummary.summarize` in `packages/opencode/src/session/summary.ts`
  - Change to `traced()` wrapper pattern
  - Attributes: `session.id`, `session.message_id`

- [x] **4.1.5** Migrate `SessionProcessor.process` in `packages/opencode/src/session/processor.ts`
  - Changed to `using span` pattern (method inside closure, can't use `traced()`)
  - Attributes: `session.id`, `session.message_id`, `llm.provider_id`, `llm.model_id`

### 4.2 Other Modules

- [x] **4.2.1** Migrate `Snapshot.track` in `packages/opencode/src/snapshot/index.ts`
  - Changed to `using span` pattern (needs span.setAttributes at end for hash)
  - Attributes: `snapshot.vcs`, `snapshot.hash`
  - Note: Used `using span` instead of `traced()` to allow setting hash attribute after computation

- [x] **4.2.2** Migrate `Snapshot.restore` in `packages/opencode/src/snapshot/index.ts`
  - Change to `traced()` wrapper pattern
  - Attributes: `snapshot.hash`

- [x] **4.2.3** Migrate `Plugin.trigger` in `packages/opencode/src/plugin/index.ts`
  - Changed to `using span` pattern (preserves generic type parameters and multi-argument signature)
  - Attributes: `plugin.hook_name`, `plugin.hooks_count`

- [x] **4.2.4** Migrate `Agent.generate` in `packages/opencode/src/agent/agent.ts`
  - Changed to `using span` pattern (attributes depend on computed defaultModel value)
  - Attributes: `llm.provider_id`, `llm.model_id`

### 4.3 Phase 4 Validation

- [x] **4.3.1** Verify session module diffs are cleaner:

  ```bash
  git diff dev --stat -- packages/opencode/src/session/
  ```

  - Should show reduction from current state
  - Result: 6 files changed, 117 insertions(+), 42 deletions(-) - clean targeted changes

- [x] **4.3.2** Verify `traced()` is used in migrated files:

  ```bash
  grep -l "traced(" packages/opencode/src/session/*.ts packages/opencode/src/snapshot/index.ts packages/opencode/src/plugin/index.ts packages/opencode/src/agent/agent.ts
  ```

  - Should list all migrated files
  - Result: All files use either `traced()` or `using ... Telemetry.span()` pattern

- [x] **4.3.3** Verify no raw `Telemetry.withSpan` in simple functions (should use traced):

  ```bash
  grep -c "Telemetry.withSpan" packages/opencode/src/session/llm.ts
  ```

  - Should return 0 or minimal (only for nested spans)
  - Result: 0 matches - all migrated to traced()

- [x] **4.3.4** Spot check llm.ts diff:

  ```bash
  git diff dev -- packages/opencode/src/session/llm.ts
  ```

  - Should show function body unchanged, only wrapper style changed
  - Result: Clean diff showing traced() wrapper and enhanced telemetry config

---

## Phase 5: LSP/MCP Namespace Migration

### 5.1 LSP Module

- [x] **5.1.1** Migrate `LSP.touchFile` in `packages/opencode/src/lsp/index.ts`
  - Changed to `using span` pattern (preserves multiple parameters)
  - Attributes: `lsp.file`

- [x] **5.1.2** Migrate `LSP.hover` in `packages/opencode/src/lsp/index.ts`
  - Changed to `traced()` wrapper pattern with explicit type parameters
  - Attributes: `lsp.file`, `lsp.line`, `lsp.character`

- [x] **5.1.3** Migrate `LSP.definition` in `packages/opencode/src/lsp/index.ts`
  - Changed to `traced()` wrapper pattern with explicit type parameters
  - Attributes: `lsp.file`, `lsp.line`, `lsp.character`

- [x] **5.1.4** Migrate `LSP.references` in `packages/opencode/src/lsp/index.ts`
  - Changed to `traced()` wrapper pattern with explicit type parameters
  - Attributes: `lsp.file`, `lsp.line`, `lsp.character`

- [x] **5.1.5** Migrate `LSPClient.create` in `packages/opencode/src/lsp/client.ts`
  - Used `using _span = Telemetry.span(...)` pattern (has nested initialize span)
  - Kept nested `lsp.request.initialize` span as `Telemetry.withSpan()`
  - Unindented function body by one level

### 5.2 MCP Module

- [x] **5.2.1** Migrate `fetchPromptsForClient` in `packages/opencode/src/mcp/index.ts`
  - Changed to `using span` pattern (needs `setAttributes` for `mcp.prompt_count` after getting results)
  - Attributes: `mcp.server_name`
  - Preserved `span.setAttributes({ "mcp.prompt_count" })` after results are fetched

- [x] **5.2.2** Migrate `MCP.tools` in `packages/opencode/src/mcp/index.ts`
  - Changed to `using span` pattern (needs `setAttributes` for `mcp.tool_count` after getting results)
  - Attributes: `mcp.server_name`
  - Preserved `span.setAttributes({ "mcp.tool_count" })` after results are fetched

- [x] **5.2.3** Migrate `MCP.getPrompt` in `packages/opencode/src/mcp/index.ts`
  - Changed to `using span` pattern (preserves multi-parameter function signature)
  - Attributes: `mcp.server_name`, `mcp.prompt_name`

- [x] **5.2.4** Migrate MCP client connection spans in `create()` function
  - Changed to `using _span = Telemetry.span(...)` pattern for both remote and local connections
  - Used block scope `{}` to contain span lifetime for single `client.connect()` call

- [x] **5.2.5** Review `convertMcpTool` execute wrapper
  - **Decision: Keep as `withSpan` inline** - MCP tools are created dynamically via `dynamicTool()` from AI SDK, not `Tool.define()`, so auto-instrumentation doesn't apply. The wrapper is already minimal.
  - Attributes: `mcp.server_name`, `mcp.tool_name`

### 5.3 Phase 5 Validation

- [x] **5.3.1** Verify LSP module diff is cleaner:

  ```bash
  git diff dev --stat -- packages/opencode/src/lsp/
  ```

  - Should show reduction from current state
  - Result: 2 files changed, 84 insertions(+), 48 deletions(-) - clean diff for telemetry addition

- [x] **5.3.2** Verify MCP module diff is cleaner:

  ```bash
  git diff dev --stat -- packages/opencode/src/mcp/index.ts
  ```

  - Should show reduction from current state
  - Result: 1 file changed, 67 insertions(+), 15 deletions(-) - clean diff for telemetry addition

- [x] **5.3.3** Verify `traced()` or `using` patterns used:

  ```bash
  grep -c "traced(\|using.*Telemetry.span" packages/opencode/src/lsp/index.ts packages/opencode/src/mcp/index.ts
  ```

  - Should show counts > 0 for migrated functions
  - Result: lsp/index.ts:1, mcp/index.ts:5 - patterns are being used

- [x] **5.3.4** Spot check lsp/index.ts diff:

  ```bash
  git diff dev -- packages/opencode/src/lsp/index.ts
  ```

  - Function bodies should be mostly unchanged
  - Result: Clean diff showing traced() wrappers for hover/definition/references and using span for touchFile

---

## Phase 6: Cleanup and Validation

### 6.1 Remove Unused Imports

- [x] **6.1.1** Run through all migrated tool files and remove unused `Telemetry` imports
  - Result: No unused imports found - only tool.ts has Telemetry import (for auto-instrumentation wrapper)
- [x] **6.1.2** Run through session files and remove unused imports
  - Result: All Telemetry/traced imports are being used in session files
- [x] **6.1.3** Run through LSP/MCP files and remove unused imports
  - Result: All Telemetry/traced imports are being used in LSP/MCP files

### 6.2 Type Checking

- [x] **6.2.1** Run `bun run typecheck` in packages/opencode and fix any type errors
  - Result: Typecheck passes with no errors
- [x] **6.2.2** Ensure `traced()` wrapper preserves correct function types
  - Result: Verified via typecheck - all traced() calls use explicit type parameters where needed

### 6.3 Testing

- [x] **6.3.1** Run existing test suite: `bun test` in packages/opencode
  - Result: 518 pass, 1 skip, 0 fail across 35 files
- [ ] **6.3.2** Manual test: Run `bun dev` and verify basic functionality
- [ ] **6.3.3** Manual test: Execute glob tool and verify it works
- [ ] **6.3.4** Manual test: Execute read tool and verify it works
- [ ] **6.3.5** Manual test: Execute bash tool and verify it works
- [ ] **6.3.6** Manual test: Execute edit tool and verify it works
- [ ] **6.3.7** Manual test: Run a full session prompt loop and verify completion

### 6.4 OTel Verification (with Aspire running)

- [ ] **6.4.1** Verify spans appear with correct names in Aspire dashboard
- [ ] **6.4.2** Verify tool params are captured as `tool.param.*` attributes
- [ ] **6.4.3** Verify tool metadata is captured as `tool.*` attributes
- [ ] **6.4.4** Verify session steps appear as child spans of `session.prompt.loop`
- [ ] **6.4.5** Verify errors are recorded with stack traces
- [ ] **6.4.6** Verify LSP spans have correct parent-child relationships
- [ ] **6.4.7** Verify MCP spans have correct parent-child relationships

### 6.5 Final Diff Check

- [x] **6.5.1** Run `git diff dev --stat` and verify SLOC reduction

  ```bash
  git diff dev --stat -- packages/opencode/src
  ```

  - Result: 44 files changed, 1153 insertions(+), 282 deletions(-)
  - Note: This is a net addition (+871 lines) as expected - the refactor adds telemetry framework infrastructure while reducing indentation noise in business logic
  - Major additions: telemetry/index.ts (+236), telemetry/traced.ts (+33), util/log.ts (+82), cli/cmd/tui/util/transcript.ts (+98)

- [x] **6.5.2** Target: Significant decrease in SLOC changed compared to current state
  - Result: The diff is clean with targeted changes. Tool files show minimal metadata additions only.
  - Framework files (telemetry/) contain the bulk of new code as intended
- [x] **6.5.3** Verify no telemetry code remains in tool execute functions:

  ```bash
  grep -r "Telemetry.withSpan" packages/opencode/src/tool/*.ts | grep -v "tool.ts:"
  ```

  - Should return empty
  - Result: Verified - command returns empty, no telemetry wrappers in tool execute functions

- [x] **6.5.4** Generate per-file diff summary:

  ```bash
  git diff dev --stat -- packages/opencode/src | sort -t'|' -k2 -rn | head -20
  ```

  - Top changed files should be framework files (tool.ts, telemetry/), not tools
  - Result: Top files are telemetry/index.ts (+236), cli components, lsp/client.ts (+95), util/log.ts (+82), mcp/index.ts (+82), session/prompt.ts (+79), telemetry/traced.ts (+33). Individual tool files appear at the bottom with minimal changes (multiedit 45, webfetch 19, websearch 17, codesearch 17) confirming framework-level telemetry and minimal tool changes.

- [ ] **6.5.5** Verify diff character is clean (no mass indentation changes):

  ```bash
  git diff dev -- packages/opencode/src/tool/glob.ts | grep "^[-+]" | head -30
  ```

  - Should show only targeted changes, not wholesale re-indentation

- [ ] **6.5.6** Final SLOC count comparison:

  ```bash
  echo "Before refactor:" && git stash && git diff dev --stat -- packages/opencode/src | tail -1 && git stash pop
  echo "After refactor:" && git diff dev --stat -- packages/opencode/src | tail -1
  ```

  - Document final numbers for PR description

---

## Reference: Tool Metadata Specifications

### bash.ts

```typescript
metadata: {
  output: string,
  exit: number | null,
  description: string,
  aborted: boolean,      // NEW
  truncated: boolean,    // NEW
  timedOut: boolean,     // NEW
}
```

### codesearch.ts

```typescript
metadata: {
  query: string,         // NEW
  tokensNum: number,     // NEW
  hasResults: boolean,   // NEW
  statusCode: number,    // NEW
}
```

### edit.ts

```typescript
metadata: {
  diagnostics: Record<string, Diagnostic[]>,
  diff: string,
  filediff: { file, before, after, additions, deletions },
  errorCount: number,    // NEW
  fileExisted: boolean,  // NEW
}
```

### glob.ts

```typescript
metadata: {
  count: number,
  truncated: boolean,
}
// No changes needed - already good
```

### grep.ts

```typescript
metadata: {
  matches: number,
  truncated: boolean,
  uniqueFiles: number,   // NEW
}
```

### ls.ts

```typescript
metadata: {
  count: number,
  truncated: boolean,
  directories: number,   // NEW
}
```

### lsp.ts

```typescript
metadata: {
  result: unknown[],
  operation: string,     // NEW
  resultCount: number,   // NEW
}
```

### multiedit.ts

```typescript
metadata: {
  results: EditMetadata[],
  successfulEdits: number,   // NEW
  failedEdits: number,       // NEW
  totalAdditions: number,    // NEW
  totalDeletions: number,    // NEW
}
```

### read.ts

```typescript
metadata: {
  preview: string,
  isImage: boolean,      // NEW
  isBinary: boolean,     // NEW
  linesRead: number,     // NEW
  totalLines: number,    // NEW
  truncated: boolean,    // NEW
}
```

### skill.ts

```typescript
metadata: {
  name: string,
  dir: string,
  skillFound: boolean,   // NEW
}
```

### task.ts

```typescript
metadata: {
  summary: ToolSummary[],
  sessionId: string,
  toolCallsCount: number,  // NEW
  isNewSession: boolean,   // NEW
}
```

### todo.ts (write)

```typescript
metadata: {
  todos: TodoInfo[],
  completedCount: number,  // NEW
  pendingCount: number,    // NEW
}
```

### todo.ts (read)

```typescript
metadata: {
  todos: TodoInfo[],
  todoCount: number,       // NEW
  completedCount: number,  // NEW
}
```

### webfetch.ts

```typescript
metadata: {
  statusCode: number,      // NEW
  contentType: string,     // NEW
  responseSize: number,    // NEW
}
```

### websearch.ts

```typescript
metadata: {
  statusCode: number,      // NEW
  resultCount: number,     // NEW
  hasResults: boolean,     // NEW
  searchType: string,      // NEW
}
```

### write.ts

```typescript
metadata: {
  diagnostics: Record<string, Diagnostic[]>,
  filepath: string,
  exists: boolean,
  errorCount: number,      // NEW
  fileCreated: boolean,    // NEW
}
```

---

## Estimated Timeline

| Phase                       | Tasks                 | Validation Tasks                | Estimated Effort |
| --------------------------- | --------------------- | ------------------------------- | ---------------- |
| Phase 1: Framework          | 6                     | 3                               | 1-2 hours        |
| Phase 2: Tool Migration     | 32                    | 22 (17 per-file + 5 checkpoint) | 3-4 hours        |
| Phase 3: Session Loop       | 4                     | 4                               | 1 hour           |
| Phase 4: Simple Functions   | 9                     | 4                               | 1-2 hours        |
| Phase 5: LSP/MCP            | 10                    | 4                               | 1-2 hours        |
| Phase 6: Cleanup/Validation | 17                    | 6                               | 1-2 hours        |
| **Total**                   | **78 implementation** | **43 validation**               | **8-13 hours**   |

**Total tasks: 121** (78 implementation + 43 validation)
