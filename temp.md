## Enabling OpenTelemetry

1. Add to your **global** config (`~/.config/opencode/opencode.json`):

```json
{
  "experimental": {
    "openTelemetry": true
  }
}
```

> Note: Project-level config (`.opencode/opencode.jsonc`) does not work for this setting.

2. Run with Aspire Dashboard:

```bash
cd packages/opencode
bun run dev:otel
```

3. Open dashboard at http://localhost:18888

The `OTEL_EXPORTER_OTLP_ENDPOINT` env var controls the endpoint (defaults to `http://localhost:4317`).
