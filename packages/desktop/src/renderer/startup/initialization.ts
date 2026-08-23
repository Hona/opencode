import type { ElectronAPI } from "../api-types"

type SidecarData = Awaited<ReturnType<ElectronAPI["awaitInitialization"]>>

export function initializationData<A>(state: (() => A | undefined) & { error: unknown }) {
  if (state.error !== undefined) throw markLocalServerStartup(state.error)
  return state()
}

export function sidecarHttp(data: SidecarData) {
  return {
    url: data.url,
    username: data.username ?? undefined,
    password: data.password ?? undefined,
  }
}

export function createSidecarResolver(input: {
  api: Pick<ElectronAPI, "awaitInitialization">
  update: (data: SidecarData) => void
}) {
  return async (signal: AbortSignal) => {
    if (signal.aborted) throw signal.reason
    const next = await input.api.awaitInitialization()
    if (signal.aborted) throw signal.reason
    input.update(next)
    return sidecarHttp(next)
  }
}

function markLocalServerStartup(error: unknown) {
  const failure = error instanceof Error ? error : new Error(String(error))
  Object.defineProperty(failure, "localServerStartup", { value: true })
  return failure
}
