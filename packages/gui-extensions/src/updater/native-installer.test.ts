import { expect, test } from "bun:test"
import { nativeArm64Installers } from "./native-installer"

const arm64 = { url: "opencode-desktop-win-arm64.exe", sha512: "a" }

const x64 = { url: "opencode-desktop-win-x64.exe", sha512: "b" }

test.each([
  {
    name: "x64 under emulation on Windows ARM64",
    platform: "win32",
    translated: true,
    files: [arm64, x64],
    expected: [arm64],
  },
  { name: "native Windows", platform: "win32", translated: false, files: [arm64, x64], expected: undefined },
  {
    name: "a release without an ARM64 installer",
    platform: "win32",
    translated: true,
    files: [x64],
    expected: undefined,
  },
  {
    name: "Rosetta, which electron-updater handles",
    platform: "darwin",
    translated: true,
    files: [arm64, x64],
    expected: undefined,
  },
])("installer choice for $name", (input) => {
  expect(nativeArm64Installers(input.files, input)).toEqual(input.expected)
})
