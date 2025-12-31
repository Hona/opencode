export function getPtyLibName(os?: string, arch?: string): string {
  const platform = os ?? process.platform
  const architecture = arch ?? process.arch

  if (platform === "win32") return "rust_pty.dll"
  if (platform === "linux") return architecture === "arm64" ? "librust_pty_arm64.so" : "librust_pty.so"
  return architecture === "arm64" ? "librust_pty_arm64.dylib" : "librust_pty.dylib"
}
