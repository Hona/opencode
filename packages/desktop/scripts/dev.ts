import { $ } from "bun"
import { buildCliToResources, downloadCliToResources, windowsify } from "./utils"

type ServerSource = { type: "build" } | { type: "download"; version: string }
type DevOptions = { server: ServerSource; electron: string[] }

async function main() {
  const options = selectOptions()
  await prepareServer(options.server)
  await startDesktop(options.electron)
}

function selectOptions(): DevOptions {
  const args = process.argv.slice(2)
  const build = args.indexOf("--build-server")
  const download = args.indexOf("--download-server")
  if (build >= 0 && download >= 0) {
    throw new Error("--build-server and --download-server cannot be used together")
  }
  if (download >= 0 && !args[download + 1]) throw new Error("--download-server requires a version")
  const consumed = new Set([build, download, download >= 0 ? download + 1 : -1])
  return {
    server: download >= 0 ? { type: "download", version: args[download + 1] } : { type: "build" },
    electron: args.filter((_, index) => !consumed.has(index)),
  }
}

async function prepareServer(source: ServerSource) {
  const destination = windowsify("resources/opencode-cli-dev")
  if (source.type === "download") return downloadCliToResources(source.version, destination)
  return buildCliToResources(destination)
}

async function startDesktop(args: string[]) {
  process.env.OPENCODE_DESKTOP_ISOLATED_SERVER = "1"
  await $`electron-vite dev ${args}`
}

await main()
