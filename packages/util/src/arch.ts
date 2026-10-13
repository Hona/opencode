/**
 * The CPU architecture for diagnostics. An x64 build on Windows ARM64 runs under emulation, where `process.arch` and
 * PROCESSOR_ARCHITECTURE both report x64 but PROCESSOR_IDENTIFIER still names the ARM host CPU.
 */
export function describeArch() {
  if (process.platform === "win32" && process.arch === "x64" && process.env.PROCESSOR_IDENTIFIER?.startsWith("ARM"))
    return "x64, emulated on ARM64"
  return process.arch
}
