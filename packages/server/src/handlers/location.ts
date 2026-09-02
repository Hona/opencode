import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { LocationNotFoundError } from "@opencode-ai/protocol/errors"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { requestRef } from "../location"

export const LocationHandler = HttpApiBuilder.group(Api, "server.location", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    const fs = yield* FSUtil.Service
    return handlers.handle(
      "location.get",
      Effect.fn(function* (ctx) {
        const ref = requestRef(ctx.request)
        // Workspace placement owns its filesystem. Check local paths before booting location services.
        if (ref.workspaceID === undefined) {
          const info = yield* fs.stat(ref.directory).pipe(
            Effect.catchIf(
              (error) =>
                error.reason._tag === "NotFound" ||
                (error.reason._tag === "BadResource" &&
                  Schema.is(Schema.Struct({ code: Schema.Literal("ENOTDIR") }))(error.cause)),
              () => Effect.undefined,
            ),
            Effect.orDie,
          )
          if (info?.type !== "Directory")
            return yield* new LocationNotFoundError({
              directory: ref.directory,
              message: `Location directory not found: ${ref.directory}`,
            })
        }
        return yield* Effect.gen(function* () {
          const location = yield* Location.Service
          return new Location.Info({
            directory: location.directory,
            workspaceID: location.workspaceID,
            project: location.project,
          })
        }).pipe(Effect.provide(locations.get(ref)))
      }),
    )
  }),
)
