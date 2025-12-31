import path from "path"
import fs from "fs/promises"

export const SIDECAR_BINARIES: Array<{ rustTarget: string; ocBinary: string; assetExt: string }> = [
  {
    rustTarget: "aarch64-apple-darwin",
    ocBinary: "opencode-darwin-arm64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-apple-darwin",
    ocBinary: "opencode-darwin-x64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-pc-windows-msvc",
    ocBinary: "opencode-windows-x64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-unknown-linux-gnu",
    ocBinary: "opencode-linux-x64",
    assetExt: "tar.gz",
  },
  {
    rustTarget: "aarch64-unknown-linux-gnu",
    ocBinary: "opencode-linux-arm64",
    assetExt: "tar.gz",
  },
]

export const RUST_TARGET =
  Bun.env.RUST_TARGET ||
  Bun.env.TAURI_ENV_TARGET_TRIPLE ||
  (process.platform === "win32"
    ? "x86_64-pc-windows-msvc"
    : process.platform === "darwin"
      ? process.arch === "arm64"
        ? "aarch64-apple-darwin"
        : "x86_64-apple-darwin"
      : "x86_64-unknown-linux-gnu")

export function getCurrentSidecar(target = RUST_TARGET) {
  const binaryConfig = SIDECAR_BINARIES.find((b) => b.rustTarget === target)
  if (!binaryConfig) throw new Error(`Sidecar configuration not available for Rust target '${target}'`)

  return binaryConfig
}

export async function copyBinaryToSidecarFolder(source: string, target = RUST_TARGET) {
  const destDir = "src-tauri/sidecars"
  await fs.mkdir(destDir, { recursive: true })
  const dest = `${destDir}/opencode-cli-${target}${process.platform === "win32" ? ".exe" : ""}`
  await fs.copyFile(source, dest)

  console.log(`Copied ${source} to ${dest}`)

  const isWindows = target.includes("windows")
  const isLinux = target.includes("linux")
  const isArm64 = target.startsWith("aarch64")

  const ptyLib = isWindows
    ? "rust_pty.dll"
    : isLinux
      ? isArm64
        ? "librust_pty_arm64.so"
        : "librust_pty.so"
      : isArm64
        ? "librust_pty_arm64.dylib"
        : "librust_pty.dylib"

  const ptySource = path.join(path.dirname(source), ptyLib)
  const ptySourceExists = await fs
    .access(ptySource)
    .then(() => true)
    .catch(() => false)
  if (ptySourceExists) {
    await fs.copyFile(ptySource, path.join(destDir, ptyLib))
    console.log(`Copied ${ptySource} to ${destDir}/${ptyLib}`)
  }
}
