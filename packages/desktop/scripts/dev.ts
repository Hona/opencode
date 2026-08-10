import { $ } from "bun"
import { parseArgs } from "node:util"
import { buildCliToResources, downloadCliToResources } from "./utils"

type ServerSource = { type: "build" } | { type: "download"; version: string }

async function main() {
  const server = selectServer()
  await prepareServer(server)
  await startDesktop()
}

function selectServer(): ServerSource {
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
  if (options["download-server"]) return { type: "download", version: options["download-server"] }
  return { type: "build" }
}

async function prepareServer(source: ServerSource) {
  if (source.type === "download") return downloadCliToResources(source.version)
  return buildCliToResources()
}

async function startDesktop() {
  process.env.OPENCODE_DESKTOP_ISOLATED_SERVER = "1"
  await $`electron-vite dev`
}

await main()
