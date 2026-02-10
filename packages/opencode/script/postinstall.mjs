#!/usr/bin/env node

import fs from "fs"
import crypto from "crypto"
import path from "path"
import os from "os"
import { createRequire } from "module"

const require = createRequire(import.meta.url)

function detectPlatformAndArch() {
  // Map platform names
  let platform
  switch (os.platform()) {
    case "darwin":
      platform = "darwin"
      break
    case "linux":
      platform = "linux"
      break
    case "win32":
      platform = "windows"
      break
    default:
      platform = os.platform()
      break
  }

  // Map architecture names
  let arch
  switch (os.arch()) {
    case "x64":
      arch = "x64"
      break
    case "arm64":
      arch = "arm64"
      break
    case "arm":
      arch = "arm"
      break
    default:
      arch = os.arch()
      break
  }

  return { platform, arch }
}

function findBinary() {
  const { platform, arch } = detectPlatformAndArch()
  const binaryName = platform === "windows" ? "opencode.exe" : "opencode"

  // Try modern variant first, then baseline (for CPUs without AVX2)
  const candidates = [`opencode-${platform}-${arch}`, `opencode-${platform}-${arch}-baseline`]

  for (const packageName of candidates) {
    try {
      const packageJsonPath = require.resolve(`${packageName}/package.json`)
      const packageDir = path.dirname(packageJsonPath)
      const binaryPath = path.join(packageDir, "bin", binaryName)

      if (fs.existsSync(binaryPath)) {
        return { binaryPath, binaryName }
      }
    } catch {
      // Package not installed, try next candidate
    }
  }

  throw new Error(`Could not find platform binary for ${platform}-${arch}`)
}

function findBunShimPath() {
  // Mirrors Bun's openGlobalBinDir() resolution order from
  // src/install/PackageManager/PackageManagerOptions.zig:201-233
  //   1. $BUN_INSTALL_BIN
  //   2. (bunfig.toml globalBinDir — not accessible from postinstall)
  //   3. $BUN_INSTALL/bin
  //   4. $XDG_CACHE_HOME/.bun/bin
  //   5. $HOME/.bun/bin
  const candidates = [
    process.env.BUN_INSTALL_BIN,
    process.env.BUN_INSTALL && path.join(process.env.BUN_INSTALL, "bin"),
    process.env.XDG_CACHE_HOME && path.join(process.env.XDG_CACHE_HOME, ".bun", "bin"),
    path.join(os.homedir(), ".bun", "bin"),
  ]

  for (const binDir of candidates) {
    if (!binDir) continue
    const shimPath = path.join(binDir, "opencode.exe")
    if (fs.existsSync(shimPath)) {
      return shimPath
    }
  }
  return null
}

function replaceBunShim(realBinaryPath) {
  const shimPath = findBunShimPath()
  if (!shimPath) {
    console.log("Bun shim not found, skipping replacement")
    return
  }

  // Check if the shim is already the real binary by comparing file hashes
  const shimHash = crypto.createHash("sha256").update(fs.readFileSync(shimPath)).digest("hex")
  const realHash = crypto.createHash("sha256").update(fs.readFileSync(realBinaryPath)).digest("hex")
  if (shimHash === realHash) {
    console.log("Bun shim already replaced with real binary")
    return
  }

  console.log("Replacing Bun shim with real binary")
  console.log(`  shim: ${shimPath}`)
  console.log(`  real: ${realBinaryPath}`)
  fs.copyFileSync(realBinaryPath, shimPath)
  console.log("Bun shim replaced successfully")
}

async function main() {
  try {
    if (os.platform() === "win32") {
      // On Windows, Bun's global install creates a tiny shim exe (~15KB) that
      // launches the JS wrapper via spawnSync. This shim receives CTRL_C_EVENT
      // from the Windows console and dies instantly, killing the real opencode
      // process before it can handle the signal gracefully.
      //
      // Fix: replace the shim with the real compiled binary so Ctrl+C goes
      // directly to opencode's signal handler (which uses the anomalyco/bun
      // fork with the SIGINT fix from PR #25876).
      const agent = (process.env.npm_config_user_agent || "").toLowerCase()
      if (agent.startsWith("bun")) {
        const { binaryPath } = findBinary()
        replaceBunShim(binaryPath)
      }
      return
    }

    // On non-Windows platforms, just verify the binary package exists
    // Don't replace the wrapper script - it handles binary execution
    const { binaryPath } = findBinary()
    console.log(`Platform binary verified at: ${binaryPath}`)
    console.log("Wrapper script will handle binary execution")
  } catch (error) {
    console.error("Failed to setup opencode binary:", error.message)
    process.exit(1)
  }
}

try {
  main()
} catch (error) {
  console.error("Postinstall script error:", error.message)
  process.exit(0)
}
