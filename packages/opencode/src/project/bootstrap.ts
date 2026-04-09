import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "../lsp"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Snapshot } from "../snapshot"
import { Project } from "./project"
import { Vcs } from "./vcs"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Log } from "@/util/log"
import { ShareNext } from "@/share/share-next"

const debug = process.env.OPENCODE_E2E_LOG_CLEANUP === "1"

const step = async (name: string, fn: () => Promise<void> | void) => {
  const start = Date.now()
  if (debug) console.error(`[e2e:boot] start ${name}`)
  return Promise.resolve(fn()).then(
    () => {
      if (debug) console.error(`[e2e:boot] done ${name} (${Date.now() - start}ms)`)
    },
    (err) => {
      if (debug) {
        console.error(`[e2e:boot] failed ${name} (${Date.now() - start}ms)`)
        console.error(err)
      }
      throw err
    },
  )
}

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  await step("Plugin.init", () => Plugin.init())
  await step("ShareNext.init", () => ShareNext.init())
  await step("Format.init", () => Format.init())
  await step("LSP.init", () => LSP.init())
  await step("File.init", () => File.init())
  await step("FileWatcher.init", () => FileWatcher.init())
  await step("Vcs.init", () => Vcs.init())
  await step("Snapshot.init", () => Snapshot.init())

  await step("Bus.subscribe command.executed", () => {
    Bus.subscribe(Command.Event.Executed, async (payload) => {
      if (payload.properties.name === Command.Default.INIT) {
        Project.setInitialized(Instance.project.id)
      }
    })
  })
}
