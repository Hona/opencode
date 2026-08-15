#!/usr/bin/env bun

import { NodeRuntime } from "@effect/platform-node"
import { Observability } from "@opencode-ai/util/observability"
import { Effect } from "effect"
import { ServerProcess } from "./server-process"
import { OPENCODE_CHANNEL, OPENCODE_LOCAL, OPENCODE_VERSION } from "./version"

const args = process.argv.slice(2)
const hostnameIndex = args.indexOf("--hostname")
const portIndex = args.indexOf("--port")
const port = portIndex === -1 ? undefined : Number(args[portIndex + 1])
if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65_535)) {
  throw new Error(`Invalid port: ${args[portIndex + 1] ?? ""}`)
}

Effect.logInfo("cli starting", {
  version: OPENCODE_VERSION,
  channel: OPENCODE_CHANNEL,
  local: OPENCODE_LOCAL,
  args,
}).pipe(
  Effect.annotateLogs({ role: "cli" }),
  Effect.andThen(
    ServerProcess.run({
      mode: "service",
      hostname: hostnameIndex === -1 ? undefined : args[hostnameIndex + 1],
      port,
    }),
  ),
  Effect.provide(
    Observability.layer({
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      headers: process.env.OTEL_EXPORTER_OTLP_HEADERS,
      client: process.env.OPENCODE_CLIENT ?? "cli",
      version: OPENCODE_VERSION,
      channel: OPENCODE_CHANNEL,
    }),
  ),
  Effect.scoped,
  NodeRuntime.runMain,
)
