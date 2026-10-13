import { expect, test } from "bun:test"
import { nativeArm64Installers } from "./native-installer"

const arm64 = { url: "opencode-desktop-win-arm64.exe", sha512: "a" }

const x64 = { url: "opencode-desktop-win-x64.exe", sha512: "b" }

test.each([
  { name: "x64 under emulation on Windows ARM64", platform: "win32", translated: true, arm64: true, switches: true },
  { name: "native Windows", platform: "win32", translated: false, arm64: true, switches: false },
  { name: "a release without an ARM64 installer", platform: "win32", translated: true, arm64: false, switches: false },
  {
    name: "Rosetta, which electron-updater handles",
    platform: "darwin",
    translated: true,
    arm64: true,
    switches: false,
  },
])("installer choice for $name", (input) => {
  const files = input.arm64 ? [arm64, x64] : [x64]

  expect(nativeArm64Installers(files, input)).toEqual(input.switches ? [arm64] : undefined)
})
