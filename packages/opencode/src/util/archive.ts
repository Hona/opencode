import { $ } from "bun"
import { Filesystem } from "../util/filesystem"

export namespace Archive {
  export async function extractZip(zipPath: string, destDir: string) {
    if (process.platform === "win32") {
      const winZipPath = Filesystem.resolve(zipPath)
      const winDestDir = Filesystem.resolve(destDir)
      // $global:ProgressPreference suppresses PowerShell's blue progress bar popup
      const cmd = `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '${winZipPath}' -DestinationPath '${winDestDir}' -Force`
      await $`powershell -NoProfile -NonInteractive -Command ${cmd}`.quiet()
    } else {
      await $`unzip -o -q ${zipPath} -d ${destDir}`.quiet()
    }
  }
}
