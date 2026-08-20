import { homedir } from "node:os"
import { join, posix, win32 } from "node:path"

export function developmentUserData(
  platform = process.platform,
  env: Readonly<Record<string, string | undefined>> = process.env,
  home = homedir(),
) {
  if (platform === "win32")
    return win32.join(env.APPDATA ?? win32.join(home, "AppData", "Roaming"), "ai.opencode.desktop.dev")
  if (platform === "darwin") return posix.join(home, "Library", "Application Support", "ai.opencode.desktop.dev")
  return posix.join(env.XDG_CONFIG_HOME ?? posix.join(home, ".config"), "ai.opencode.desktop.dev")
}

export function developmentService(input: { cli: string; userData: string; version: string }) {
  return {
    file: join(input.userData, "opencode", "service-local.json"),
    version: input.version,
    command: [
      "bun",
      "run",
      "--cwd",
      input.cli,
      `--define=OPENCODE_VERSION=${JSON.stringify(input.version)}`,
      "src/index.ts",
      "serve",
      "--service",
      "--port",
      "0",
    ],
    env: {
      XDG_STATE_HOME: input.userData,
      OPENCODE_CLIENT: "desktop",
      OPENCODE_DISABLE_EMBEDDED_WEB_UI: "true",
    },
  }
}
