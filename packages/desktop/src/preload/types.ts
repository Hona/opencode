import type { StorageSnapshot } from "../shared/ipc-transport"
import type { WindowBootstrap } from "../shared/window-bootstrap"

export type ElectronNative = {
  windowID: string
  bootstrap: WindowBootstrap
  storageSnapshot: Promise<StorageSnapshot>
  disabledExtensions: Promise<readonly string[]>
  getPathForFile(file: File): string
}
