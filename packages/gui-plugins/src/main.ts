import { compose } from "@opencode/plugin/gui/host"
import context from "./context"
import btw from "./btw"
import debug from "./debug"
import terminal from "./terminal"
import file from "./file"
import review from "./review"
import details from "./details"
import browser from "./browser"
import pairing from "./pairing"
import updater from "./updater"
import ssh from "./ssh"
import wsl from "./wsl"
import microsoftOffice from "./microsoft-office"

/**
 * Built-in plugins with their main entries. Lists every built-in so their ids stay reserved. `builtins.typecheck.ts`
 * checks that it provides every Ipc the renderer composition uses.
 */
export const builtins = compose(
  context,
  btw,
  debug,
  terminal,
  file,
  review,
  details,
  { ...browser, mainEntry: () => import("./browser/main") },
  { ...pairing, mainEntry: () => import("./pairing/main") },
  { ...updater, mainEntry: () => import("./updater/main") },
  { ...ssh, mainEntry: () => import("./ssh/main") },
  { ...wsl, mainEntry: () => import("./wsl/main") },
  microsoftOffice,
)
