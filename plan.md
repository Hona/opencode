# OpenTelemetry Config Refactor Plan

## Goal

Consolidate the duplicated "is telemetry enabled" checks into a single source of truth, following the existing `compaction` pattern where env vars override config at load time.

## Current Problem

The telemetry enablement check is repeated in 4 places with inconsistent logic:

- `packages/opencode/src/index.ts:89-96` - checks env var + config
- `packages/opencode/src/cli/cmd/tui/worker.ts:20-28` - checks env var + config
- `packages/opencode/src/session/llm.ts:205-210` - checks env var + config
- `packages/opencode/src/agent/agent.ts:223-227` - checks config only (bug)

## Backlog

### Phase 1: Add Flag Definition

- [x] In `packages/opencode/src/flag/flag.ts`, add a new flag for the OTLP endpoint:
  ```typescript
  export const OTEL_EXPORTER_OTLP_ENDPOINT = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]
  ```

### Phase 2: Apply Env Var Override in Config Loading

- [x] In `packages/opencode/src/config/config.ts`, locate the flag override section (around line 150-156 where `OPENCODE_DISABLE_AUTOCOMPACT` is applied)

- [x] Add import for `Flag` at the top of the file if not already present

- [x] After the existing flag overrides, add logic to merge the OTLP endpoint into config:
  ```typescript
  if (Flag.OTEL_EXPORTER_OTLP_ENDPOINT) {
    result.experimental = {
      ...result.experimental,
      openTelemetry: {
        enabled: true,
        endpoint: Flag.OTEL_EXPORTER_OTLP_ENDPOINT,
      },
    }
  }
  ```

### Phase 3: Add Telemetry Helper Function

- [x] In `packages/opencode/src/telemetry/index.ts`, add a new exported function `isEnabled()`:

  ```typescript
  export function isEnabled(): boolean {
    return initialized
  }
  ```

  NOTE: The function already exists at line 102-104. It only checks `initialized` because `init()` returns early if `config.enabled` is false, so `initialized=true` implies telemetry was enabled.

- [x] Ensure `config` variable is accessible to this function (it's already module-scoped based on `resolveConfig` usage)

### Phase 4: Simplify CLI Entry Points

- [x] In `packages/opencode/src/index.ts`, simplify lines 89-96:
  - Remove the `otelEndpoint` variable and direct env var check
  - Just check `globalConfig?.experimental?.openTelemetry` since env var is now applied to config
  - Update the condition to:
    ```typescript
    const globalConfig = await Config.global()
    const otelConfig = globalConfig?.experimental?.openTelemetry
    if (otelConfig) {
      const config = Telemetry.resolveConfig("opencode-cli", otelConfig)
      Telemetry.init(config)
    }
    ```

- [x] In `packages/opencode/src/cli/cmd/tui/worker.ts`, apply the same simplification to lines 20-28:
  - Remove the `otelEndpoint` variable and direct env var check
  - Remove the ternary that skips config loading when env var is set
  - Update to:
    ```typescript
    const globalConfig = await Config.global()
    const otelConfig = globalConfig?.experimental?.openTelemetry
    if (otelConfig) {
      const { Telemetry } = await import("@/telemetry")
      const config = Telemetry.resolveConfig("opencode-server", otelConfig)
      Telemetry.init(config)
    }
    ```

### Phase 5: Simplify AI SDK Telemetry Checks

- [x] In `packages/opencode/src/session/llm.ts`, locate the `experimental_telemetry` block (lines 205-210)

- [x] Add import for `Telemetry` at the top of the file:

  ```typescript
  import { Telemetry } from "@/telemetry"
  ```

- [x] Replace the `isEnabled` check with the helper:

  ```typescript
  experimental_telemetry: {
    isEnabled: Telemetry.isEnabled(),
    functionId: "opencode.llm.stream",
    metadata: {
      sessionId: input.sessionID,
      modelId: input.modelID,
      providerID: input.providerID,
    },
  },
  ```

- [x] In `packages/opencode/src/agent/agent.ts`, locate the `experimental_telemetry` block (lines 223-227)

- [x] Add import for `Telemetry` at the top of the file (already present)

- [x] Replace the `isEnabled` check with the helper:
  ```typescript
  experimental_telemetry: {
    isEnabled: Telemetry.isEnabled(),
    functionId: "opencode.agent.generate",
    metadata: {
      "llm.provider_id": defaultModel.providerID,
      "llm.model_id": defaultModel.modelID,
    },
  },
  ```
  NOTE: Metadata updated to use the contextually available `defaultModel` values with dotted notation consistent with other telemetry in the codebase.

### Phase 6: Clean Up resolveConfig

- [x] In `packages/opencode/src/telemetry/index.ts`, review the `resolveConfig` function (lines 26-53)

- [x] Remove the `envEndpoint` variable and direct `process.env.OTEL_EXPORTER_OTLP_ENDPOINT` check since the env var is now applied to config at load time

- [x] Simplify `resolveConfig` to only handle the config object:

  ```typescript
  export function resolveConfig(
    serviceName: string,
    experimental?: boolean | { enabled?: boolean; endpoint?: string },
  ): Config {
    const defaultEndpoint = "http://localhost:4317"

    if (typeof experimental === "boolean") {
      return {
        enabled: experimental,
        endpoint: defaultEndpoint,
        serviceName,
      }
    }

    if (typeof experimental === "object") {
      return {
        enabled: experimental.enabled !== false,
        endpoint: experimental.endpoint || defaultEndpoint,
        serviceName,
      }
    }

    return {
      enabled: false,
      endpoint: defaultEndpoint,
      serviceName,
    }
  }
  ```

### Phase 7: Testing

- [x] Add unit tests for telemetry configuration:
  - Created `packages/opencode/test/telemetry/telemetry.test.ts` with tests for `Telemetry.resolveConfig`:
    - Returns disabled config when no experimental config provided
    - Handles boolean true/false config
    - Handles object config with enabled true/false
    - Handles object config with custom endpoint
    - Defaults enabled to true when object has no enabled field
    - Defaults endpoint when object has no endpoint field
    - Uses custom service name
  - Added tests to `packages/opencode/test/config/config.test.ts` for config loading:
    - Verifies openTelemetry config loads from file when enabled as boolean
    - Verifies openTelemetry config loads from file with custom endpoint
    - Verifies openTelemetry defaults to undefined when not configured
    - Tests OTEL_EXPORTER_OTLP_ENDPOINT env var override behavior

- [ ] (Manual) Verify telemetry works with only config enabled (no env var):
  - Set `experimental.openTelemetry: true` in opencode.jsonc
  - Run opencode and confirm telemetry initializes

- [ ] (Manual) Verify telemetry works with only env var (no config):
  - Remove any openTelemetry config
  - Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317`
  - Run opencode and confirm telemetry initializes

- [ ] (Manual) Verify env var overrides config endpoint:
  - Set `experimental.openTelemetry.endpoint: "http://config:4317"` in config
  - Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://envvar:4317`
  - Confirm the env var endpoint is used

- [ ] (Manual) Verify telemetry disabled when neither config nor env var set:
  - Remove all telemetry config and env vars
  - Run opencode and confirm telemetry does not initialize

- [ ] (Manual) Verify AI SDK telemetry is captured in traces when enabled

### Phase 8: Documentation

- [ ] Update any relevant docs in `packages/docs/` if openTelemetry configuration is documented

- [x] Add inline code comments explaining the config precedence (env var > config)

## Notes

- The `OTEL_EXPORTER_OTLP_ENDPOINT` env var is a standard OpenTelemetry convention, so we should continue to support it
- This refactor follows the existing `compaction` pattern in the codebase where `Flag.OPENCODE_DISABLE_AUTOCOMPACT` overrides config at load time
- After this refactor, there will be a single source of truth: the resolved config object
