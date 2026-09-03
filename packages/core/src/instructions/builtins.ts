export * as InstructionBuiltIns from "./builtins.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import type { Session } from "@opencode-ai/schema/session"
import { Global } from "@opencode-ai/util/global"
import { Location } from "../location.js"
import { Instructions } from "./index.js"

export interface Interface {
  readonly load: (sessionID: Session.ID) => Effect.Effect<Instructions.List>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/InstructionBuiltIns") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const location = yield* Location.Service
    return Service.of({
      load: (sessionID) =>
        Effect.succeed(
          Instructions.combine([
            Instructions.make({
              key: Instructions.Key.make("core/environment"),
              codec: Schema.toCodecJson(Schema.String),
              read: Effect.sync(() =>
                [
                  "<env>",
                  `  Current conversation session ID: ${sessionID}`,
                  `  Working directory: ${location.directory}`,
                  `  Workspace root folder: ${location.project.directory}`,
                  `  Is directory a git repo: ${location.vcs?.type === "git" ? "yes" : "no"}`,
                  `  Platform: ${process.platform}`,
                  `  Prefer ${global.tmp} over generic system temporary directories such as /tmp; it is pre-created and approved for external access.`,
                  "</env>",
                ].join("\n"),
              ),
              render: {
                initial: (environment) =>
                  ["Here is some useful information about the environment you are running in:", environment].join("\n"),
                changed: (_previous, environment) =>
                  ["The environment you are running in is now:", environment].join("\n"),
              },
            }),
            Instructions.make({
              key: Instructions.Key.make("core/date"),
              codec: Schema.toCodecJson(Schema.String),
              read: DateTime.nowAsDate.pipe(Effect.map((date) => date.toDateString())),
              render: {
                initial: (date) => `Today's date: ${date}`,
                changed: (_previous, date) => `Today's date is now: ${date}`,
              },
            }),
            Instructions.make({
              key: Instructions.Key.make("core/mermaid-guidance"),
              codec: Schema.toCodecJson(Schema.String),
              read: Effect.succeed(
                [
                  "# Mermaid diagrams",
                  "- Use fenced code blocks labelled `mermaid`.",
                  "- Put each diagram statement on its own line; do not use semicolons as statement separators.",
                  "- In sequence-diagram message text, encode a literal semicolon as `#59;`, or reword with a comma.",
                  "- Close each structural block such as `opt`, `alt`, or `loop` with `end`.",
                  "",
                  "Example:",
                  "```mermaid",
                  "sequenceDiagram",
                  "    Agent->>Plugin: Check permissions#59; create pending request",
                  "    Plugin-->>Agent: Structured result",
                  "```",
                ].join("\n"),
              ),
              render: {
                initial: (guidance) => guidance,
                changed: (_previous, guidance) => guidance,
              },
            }),
          ]),
        ),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Global.node, Location.node] })
