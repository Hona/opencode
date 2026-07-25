import { Database } from "@opencode-ai/core/database/database"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Observability } from "@opencode-ai/util/observability"
import { Schema } from "effect"

export const ServerOptions = Schema.Struct({
  app: Schema.optional(
    Schema.Struct({
      name: Schema.optional(Schema.String),
      version: Schema.optional(Schema.String),
      channel: Schema.optional(Schema.String),
    }),
  ),
  hostname: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(65_535))),
  password: Schema.optional(Schema.String),
  simulation: Schema.optional(Schema.Boolean),
  database: Schema.optional(Database.Options),
  models: Schema.optional(ModelsDev.Options),
  observability: Schema.optional(Observability.Options),
  config: Schema.optional(
    Schema.Struct({
      directory: Schema.optional(Schema.String),
      project: Schema.optional(Schema.Boolean),
      file: Schema.optional(Schema.String),
      content: Schema.optional(Schema.String),
    }),
  ),
  windows: Schema.optional(
    Schema.Struct({
      gitbash: Schema.optional(Schema.String),
    }),
  ),
  fs: Schema.optional(
    Schema.Struct({
      filewatcher: Schema.optional(Schema.Boolean),
      fff: Schema.optional(Schema.Boolean),
    }),
  ),
})
export type ServerOptions = typeof ServerOptions.Type

type Environment = Readonly<Record<string, string | undefined>>

export function fromEnvironment(options: ServerOptions = {}, environment: Environment = process.env): ServerOptions {
  const channel = options.app?.channel ?? "unknown"
  return {
    ...options,
    database: {
      path:
        options.database?.path ??
        environment.OPENCODE_DB ??
        (["latest", "beta", "prod"].includes(channel) || truthy(environment.OPENCODE_DISABLE_CHANNEL_DB)
          ? "opencode.db"
          : `opencode-${channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`),
    },
    models: {
      url: options.models?.url ?? environment.OPENCODE_MODELS_URL,
      file: options.models?.file ?? environment.OPENCODE_MODELS_PATH,
      fetch: options.models?.fetch ?? !truthy(environment.OPENCODE_DISABLE_MODELS_FETCH),
    },
    observability: {
      endpoint: options.observability?.endpoint ?? environment.OTEL_EXPORTER_OTLP_ENDPOINT,
      headers: options.observability?.headers ?? environment.OTEL_EXPORTER_OTLP_HEADERS,
    },
    config: {
      directory: options.config?.directory ?? environment.OPENCODE_CONFIG_DIR,
      project:
        options.config?.project ??
        !truthy(environment.OPENCODE_CONFIG_PROJECT_DISABLE ?? environment.OPENCODE_DISABLE_PROJECT_CONFIG),
      file: options.config?.file ?? environment.OPENCODE_CONFIG,
      content: options.config?.content ?? environment.OPENCODE_CONFIG_CONTENT,
    },
    windows: {
      gitbash: options.windows?.gitbash ?? environment.OPENCODE_GIT_BASH_PATH,
    },
    fs: {
      filewatcher:
        options.fs?.filewatcher ??
        !truthy(environment.OPENCODE_FILEWATCHER_DISABLE ?? environment.OPENCODE_DISABLE_FILEWATCHER),
      fff:
        options.fs?.fff ??
        (environment.OPENCODE_DISABLE_FFF === undefined
          ? process.platform !== "win32"
          : !truthy(environment.OPENCODE_DISABLE_FFF)),
    },
  }
}

function truthy(value?: string) {
  return value === "1" || value?.toLowerCase() === "true"
}
