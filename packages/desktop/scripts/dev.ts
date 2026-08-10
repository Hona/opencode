import { $ } from "bun"
import { parseArgs } from "node:util"
import { buildCliToResources, downloadCliToResources, windowsify } from "./utils"

type DevOptions = {
  build: boolean
  version?: string
}

async function main() {
  const options = parseOptions()
  await prepareServer(options)
  await startDesktop()
}

function parseOptions(): DevOptions {
  const options = parseArgs({
    args: process.argv.slice(2),
    options: {
      "build-server": { type: "boolean" },
      "download-server": { type: "string" },
    },
    strict: true,
  }).values
  if (options["build-server"] && options["download-server"]) {
    throw new Error("--build-server and --download-server cannot be used together")
  }
  return {
    build: options["build-server"] ?? false,
    version: options["download-server"],
  }
}

async function prepareServer(options: DevOptions) {
  if (options.version) return downloadCliToResources(options.version)
  const resource = windowsify("resources/opencode-cli")
  if (options.build || !(await Bun.file(resource).exists())) return buildCliToResources()
  console.log(`Reusing ${resource}`)
}

async function startDesktop() {
  process.env.OPENCODE_DESKTOP_ISOLATED_SERVER = "1"
  await $`electron-vite dev`
}

await main()
