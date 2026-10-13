/**
 * The installers an x64 build running under emulation on Windows ARM64 should update to. electron-updater picks the
 * file whose name contains `process.arch`, which emulation reports as x64, so the install never reaches the native
 * build otherwise. macOS is left alone: electron-updater already prefers arm64 under Rosetta.
 */
export function nativeArm64Installers<File extends { readonly url: string }>(
  files: readonly File[],
  host: { readonly platform: string; readonly translated: boolean },
) {
  if (host.platform !== "win32" || !host.translated) return undefined
  const native = files.filter((file) => file.url.includes("arm64"))

  return native.length > 0 ? native : undefined
}
