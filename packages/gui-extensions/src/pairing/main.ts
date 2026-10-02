import { powerSaveBlocker } from "electron"
import { Schema } from "effect"
import { Servers, Storage, type MainContext } from "../sdk/main"
import { Pairing } from "./contract"

/** The display sleep blocker this instance holds, if any. */
type Blocker = { id?: number }

const setup = (ctx: MainContext) => {
  const servers = ctx.use(Servers)

  const stored = ctx.use(Storage).store("keepScreenActive", {
    schema: Schema.Boolean,
    initial: false,
    from: "state:opencode.settings/keepScreenActive",
  })

  const blocker: Blocker = {}

  const release = () => {
    if (blocker.id === undefined) return
    powerSaveBlocker.stop(blocker.id)
    blocker.id = undefined
  }

  const keepScreenActive = (enabled: boolean) => {
    if (enabled && blocker.id === undefined) blocker.id = powerSaveBlocker.start("prevent-display-sleep")

    if (!enabled) release()
    stored.set(enabled)
  }

  if (stored.get()) keepScreenActive(true)
  ctx.scope.addFinalizer(release)

  const client = async () => {
    const server = servers.get("sidecar")

    if (!server) throw new Error("The local desktop server is not ready")
    const { OpenCode } = await import("@opencode/client/promise")

    return OpenCode.make({ baseUrl: server.url, headers: server.headers })
  }

  ctx.provide(Pairing, {
    info: async () => ({ urls: (await (await client()).server.info()).urls }),
    code: async () => (await (await client()).server.pair()).code,
    screenActive: () => blocker.id !== undefined && powerSaveBlocker.isStarted(blocker.id),
    setScreenActive: (enabled) => keepScreenActive(enabled),
  })
}

export default setup
