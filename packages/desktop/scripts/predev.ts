import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, RUST_TARGET } from "./utils"

const sidecarConfig = getCurrentSidecar()

const binaryPath = `../opencode/dist/${sidecarConfig.ocBinary}/bin/opencode${process.platform === "win32" ? ".exe" : ""}`

await $`cd ../opencode && bun run build --single`

await copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)
