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

- [ ] In `packages/opencode/src/config/config.ts`, locate the flag override section (around line 150-156 where `OPENCODE_DISABLE_AUTOCOMPACT` is applied)

- [ ] Add import for `Flag` at the top of the file if not already present

- [ ] After the existing flag overrides, add logic to merge the OTLP endpoint into config:
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

- [ ] In `packages/opencode/src/telemetry/index.ts`, add a new exported function `isEnabled()`:

  ```typescript
  export function isEnabled(): boolean {
    return initialized && config?.enabled === true
  }
  ```

- [ ] Ensure `config` variable is accessible to this function (it's already module-scoped based on `resolveConfig` usage)

### Phase 4: Simplify CLI Entry Points

- [ ] In `packages/opencode/src/index.ts`, simplify lines 89-96:
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

- [ ] In `packages/opencode/src/cli/cmd/tui/worker.ts`, apply the same simplification to lines 20-28:
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

- [ ] In `packages/opencode/src/session/llm.ts`, locate the `experimental_telemetry` block (lines 205-210)

- [ ] Add import for `Telemetry` at the top of the file:

  ```typescript
  import { Telemetry } from "@/telemetry"
  ```

- [ ] Replace the `isEnabled` check with the helper:

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

- [ ] In `packages/opencode/src/agent/agent.ts`, locate the `experimental_telemetry` block (lines 223-227)

- [ ] Add import for `Telemetry` at the top of the file:

  ```typescript
  import { Telemetry } from "@/telemetry"
  ```

- [ ] Replace the `isEnabled` check with the helper:
  ```typescript
  experimental_telemetry: {
    isEnabled: Telemetry.isEnabled(),
    functionId: "opencode.agent.generate",
    metadata: {
      sessionId: input.sessionID,
      modelId: input.modelID,
      providerID: input.providerID,
    },
  },
  ```

### Phase 6: Clean Up resolveConfig

- [ ] In `packages/opencode/src/telemetry/index.ts`, review the `resolveConfig` function (lines 26-53)

- [ ] Remove the `envEndpoint` variable and direct `process.env.OTEL_EXPORTER_OTLP_ENDPOINT` check since the env var is now applied to config at load time

- [ ] Simplify `resolveConfig` to only handle the config object:

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

- [ ] Verify telemetry works with only config enabled (no env var):
  - Set `experimental.openTelemetry: true` in opencode.jsonc
  - Run opencode and confirm telemetry initializes

- [ ] Verify telemetry works with only env var (no config):
  - Remove any openTelemetry config
  - Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317`
  - Run opencode and confirm telemetry initializes

- [ ] Verify env var overrides config endpoint:
  - Set `experimental.openTelemetry.endpoint: "http://config:4317"` in config
  - Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://envvar:4317`
  - Confirm the env var endpoint is used

- [ ] Verify telemetry disabled when neither config nor env var set:
  - Remove all telemetry config and env vars
  - Run opencode and confirm telemetry does not initialize

- [ ] Verify AI SDK telemetry is captured in traces when enabled

### Phase 8: Documentation

- [ ] Update any relevant docs in `packages/docs/` if openTelemetry configuration is documented

- [ ] Add inline code comments explaining the config precedence (env var > config)

## Notes

- The `OTEL_EXPORTER_OTLP_ENDPOINT` env var is a standard OpenTelemetry convention, so we should continue to support it
- This refactor follows the existing `compaction` pattern in the codebase where `Flag.OPENCODE_DISABLE_AUTOCOMPACT` overrides config at load time
- After this refactor, there will be a single source of truth: the resolved config object
