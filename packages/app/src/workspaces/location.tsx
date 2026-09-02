import { createSimpleContext } from "@opencode-ai/ui/context"
import type { LocationGetOutput, LocationRef } from "@opencode-ai/client/promise"
import { retry } from "@opencode-ai/util/retry"
import { type Accessor, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { type LocationContext, useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { isLocationNotFoundError } from "@/runtime/server/errors"
export type { LocationContext } from "@/runtime/server/client"

export type WorkspaceLocation = LocationContext & {
  readonly ref: LocationRef
  readonly current: LocationGetOutput | undefined
  readonly error: { readonly location: LocationRef; readonly cause: unknown } | undefined
}

const context = createSimpleContext({
  name: "Location",
  init: (props: {
    directory: string | Accessor<string>
    workspaceID?: string | Accessor<string | undefined>
    sessionID?: Accessor<string | undefined>
  }) => {
    const serverSDK = useServerSDK()
    const data = useData()
    const ref = createMemo(
      () => ({
        directory: typeof props.directory === "function" ? props.directory() : props.directory,
        workspaceID: typeof props.workspaceID === "function" ? props.workspaceID() : props.workspaceID,
      }),
      undefined,
      {
        equals: (previous, next) => previous.directory === next.directory && previous.workspaceID === next.workspaceID,
      },
    )
    const current = createMemo(() => data.location.info(ref()))
    const [state, setState] = createStore<{ error?: WorkspaceLocation["error"] }>({})

    createEffect(() => {
      const location = ref()
      const sessionID = props.sessionID?.()
      let stale = false
      onCleanup(() => {
        stale = true
      })
      setState("error", undefined)
      if (serverSDK.connection.status() !== "connected") return
      void retry(() => (stale ? Promise.resolve() : data.location.syncInfo(location)), {
        retryIf: (cause) => !stale && !isLocationNotFoundError(cause, location),
      })
        .then(
          () => {
            if (stale) return
            // Ancillary services failing do not mean the directory is missing.
            void retry(() => (stale ? Promise.resolve() : data.location.sync(location)), {
              retryIf: () => !stale,
            }).catch(() => undefined)
          },
          async (cause) => {
            if (stale || !isLocationNotFoundError(cause, location)) return
            if (sessionID) {
              // Finish route hydration before checking for a move missed by this client.
              await data.session.sync(sessionID, { children: true }).catch(() => undefined)
              if (stale) return
              data.session.invalidate(sessionID)
              await retry(() => (stale ? Promise.resolve() : data.session.sync(sessionID)), {
                retryIf: () => !stale,
              })
              const current = data.session.get(sessionID)?.location
              if (current?.directory !== location.directory || current.workspaceID !== location.workspaceID) return
            }
            if (stale) return
            setState("error", { location, cause })
          },
        )
        .catch(() => undefined)
    })

    const location = createMemo(() => serverSDK.ensureDirSdkContext(current()?.directory ?? ref().directory))
    return createMemo<WorkspaceLocation>(() => ({
      ...location(),
      ref: ref(),
      current: current(),
      error: state.error,
    }))
  },
})

export const useWorkspaceLocation: () => Accessor<WorkspaceLocation> = context.use
export const LocationProvider = context.provider
